# DSH MCP Lazy Tools

给 **DeepSeek Harness** 用的 MCP 工具懒加载策略：默认把 MCP 工具从每个 agent 的工具面里隐藏，模型需要时再按服务解锁。省 token，也让 PTC SDK 的体面小很多。

## 问题

一个 MCP 服务动辄十几个工具。每个工具的名字、描述、参数 schema 都会随每次请求进入上下文；服务多了以后，光这些 schema 就能吃掉几千 token，而且大部分工具在多数轮次里用不到。

## 做法

- 插件启动后，对每个新建 agent 用 `agent.ctx.tools.restrict({ deny })` 把全部 `mcp__<server>__<tool>` 从工具面摘掉（不是停连接，MCP 进程照常运行）。
- 额外注册一个很小的一级工具 **`load_mcp_tools`**：
  - 不带参数：列出当前连接的 MCP 服务和每个服务的工具名；
  - 带 `{"server": "<name>"}`：把该服务的完整 schema 返回给模型，并只为**当前 agent** 解锁这些工具，之后可直接调用 `mcp__<server>__*`。
- 解锁状态按 agent 隔离，互不影响；工具列表变化（`tools/change`）时自动重新应用过滤。
- 插件卸载会清理所有 per-agent 注册。

## 配置

```yaml
- id: mcp-lazy-tools
  name: '@satanfire/dsh-mcp-lazy-tools'
  config:
    alwaysVisible: ['codegraph']   # 这些服务不隐藏，始终可调用
```

`alwaysVisible` 可选，省略时全部 MCP 服务默认隐藏。

## 安装

```sh
git clone https://github.com/satanfire/dsh-mcp-lazy-tools.git
cd dsh-mcp-lazy-tools
dsh plugin --profile web add "$PWD"
```

或以依赖形式固定到某个提交：

```json
"@satanfire/dsh-mcp-lazy-tools": "https://codeload.github.com/satanfire/dsh-mcp-lazy-tools/tar.gz/<commit-sha>"
```

装完重启 `dsh web`。配合 [dsh-mcp-panel](https://github.com/satanfire/dsh-mcp-panel) 可以在设置页看到每台服务的工具与 token 占用。

## 兼容性

- 要求 `@deepseek-ai/dsh >= 0.2.0-rc.2`（只声明下限）。
- 依赖 `tools` 服务的 `restrict`、`schemas` 与 `tools/change` 事件。

## 许可

[MIT](LICENSE)
