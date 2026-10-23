/**
 * MCP tool lazy loading, code-mode style: MCP tools (mcp__<server>__<tool>)
 * are hidden from every agent's tool surface by default, so neither native
 * schemas nor the PTC SDK carry them. A tiny `load_mcp_tools` tool presents
 * the per-server directory on demand and unlocks one server's tools for the
 * calling agent when the model actually needs them.
 *
 * Config (optional): { alwaysVisible: string[] } — server names exempt from
 * hiding.
 */
export const inject = ['tools'];

const TOOL_NAME = 'load_mcp_tools';

/** Group the global tool surface into Map<serverName, ToolSchema[]>. */
function mcpGroups(tools) {
  const groups = new Map();
  for (const schema of tools.schemas()) {
    const match = /^mcp__(.+?)__(.+)$/.exec(schema.name);
    if (match === null) continue;
    const server = match[1];
    let list = groups.get(server);
    if (list === undefined) {
      list = [];
      groups.set(server, list);
    }
    list.push(schema);
  }
  return groups;
}

function sameNames(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function renderDirectory(groups, unlocked) {
  if (groups.size === 0) return 'No MCP servers are connected.';
  const lines = ['MCP servers (call again with {"server": "<name>"} to load one):'];
  for (const [server, schemas] of groups) {
    const state = unlocked.has(server) ? ' (already loaded)' : '';
    const names = schemas.map((s) => s.name.slice(`mcp__${server}__`.length));
    lines.push(`- ${server}${state}: ${names.join(', ')}`);
  }
  return lines.join('\n');
}

function renderServer(server, schemas) {
  const lines = [`Loaded ${schemas.length} tools of MCP server "${server}". They are now directly callable:`];
  for (const schema of schemas) {
    lines.push('', `### ${schema.name}`, schema.description.trim(), `Parameters: ${JSON.stringify(schema.parameters)}`);
  }
  return lines.join('\n');
}

export function apply(ctx, config) {
  const alwaysVisible = new Set((config && config.alwaysVisible) || []);
  const perAgent = new Map();

  ctx.on('agent/created', ({ agent }) => {
    /** Per-server active restrictions and the servers this agent unlocked. */
    const state = { unlocked: new Set(), restricted: new Map() };

    /** (Re)apply deny filters for every still-locked server. */
    const sync = () => {
      const groups = mcpGroups(ctx.tools);
      for (const [server, schemas] of groups) {
        if (alwaysVisible.has(server) || state.unlocked.has(server)) continue;
        const names = schemas.map((s) => s.name);
        const previous = state.restricted.get(server);
        if (previous !== undefined && sameNames(previous.names, names)) continue;
        if (previous !== undefined) previous.dispose();
        state.restricted.set(server, { names, dispose: agent.ctx.tools.restrict({ deny: names }) });
      }
      for (const [server, previous] of state.restricted) {
        if (!groups.has(server)) {
          previous.dispose();
          state.restricted.delete(server);
        }
      }
    };

    const dispose = agent.ctx.effect(() => {
      sync();
      const offChange = ctx.on('tools/change', sync);
      const offTool = agent.ctx.tools.register({
        name: TOOL_NAME,
        description:
          'MCP tools are hidden by default to keep the tool surface small. '
          + 'Call with no arguments to list connected MCP servers and their tool names; '
          + 'call with {"server": "<name>"} to load that server\'s full tool schemas and make them directly callable. '
          + 'Load a server before calling any mcp__<server>__* tool.',
        parameters: {
          type: 'object',
          properties: {
            server: {
              type: 'string',
              description: 'MCP server name to load. Omit to list servers.',
            },
          },
          additionalProperties: false,
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        isConcurrencySafe: () => true,
        async execute(args) {
          const groups = mcpGroups(ctx.tools);
          const server = args === null || typeof args !== 'object' ? undefined : args.server;
          if (server === undefined || server === '') return renderDirectory(groups, state.unlocked);
          const schemas = groups.get(server);
          if (schemas === undefined) {
            return `Unknown MCP server "${server}". ${renderDirectory(groups, state.unlocked)}`;
          }
          state.unlocked.add(server);
          const previous = state.restricted.get(server);
          if (previous !== undefined) {
            previous.dispose();
            state.restricted.delete(server);
          }
          return renderServer(server, schemas);
        },
      });
      return () => {
        offChange();
        offTool();
        for (const previous of state.restricted.values()) previous.dispose();
        state.restricted.clear();
        perAgent.delete(agent);
      };
    });
    perAgent.set(agent, dispose);
  });

  // Plugin-owned teardown: agent.ctx registrations survive plugin unload, so
  // dispose every per-agent effect here as well.
  ctx.effect(() => () => {
    for (const dispose of perAgent.values()) dispose();
    perAgent.clear();
  });
}
