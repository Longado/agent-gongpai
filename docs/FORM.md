# 做成插件，还是做成网页

结论：**本地网页做主界面，每个 AI 工具挂一个很薄的连接器。** 连接器先做 MCP，插件打包和浏览器扩展放到下一版。

## 为什么主界面是网页

1. 产品交付的是给人看的项目现场：目标和规划版本、任务状态、依据、点回原话、纠错。Claude Code 和 Codex 是终端工具，Cursor 是编辑器，插件只能往对话里输出文字，出不了这样的页面。claude-mem 是 Claude Code 插件，它也没有网页，管理靠命令行。
2. 核心放进任何一个工具的插件里，就被绑在那个工具上。本地服务直接读各家的会话文件，天然跨工具，这正是产品要解决的问题。
3. 读取本来就快。作者本机几百个 Claude Code 和 Codex 会话，首次同步不到 1 秒。所以不需要钩子在会话结束时推数据，钩子的价值只是省一次点击。

## 为什么连接器先做 MCP

"继续"这一步最大的摩擦是复制粘贴。Claude Code、Codex、Cursor 都支持 MCP，把"项目现场"和"续接上下文"做成两个 MCP 工具，AI 在对话里就能直接取，用户说一句"按工牌里的现场继续做 T03"就行。连接器只读，不调用模型，不改数据。

## 核实过的事实

| 工具 | 插件 | 钩子 | MCP |
|---|---|---|---|
| Claude Code | 有，插件目录可以包含技能、命令、子代理、钩子、MCP 配置，通过插件市场安装 | 30 多种事件，每个事件都带会话编号和会话记录路径 | 支持，插件里可以直接打包 |
| Codex | 有 `codex plugin` 子命令 | 本机 `~/.codex/hooks.json` 里有真实配置，事件和 Claude Code 很像；是否带会话记录路径，没有找到官方原文 | 支持，在 `~/.codex/config.toml` 里配置 |
| Cursor | 无 | 有，大部分事件带会话记录路径（关闭会话记录时为空） | 支持，`mcp.json` |

同类工具的形态：claude-mem 是 Claude Code 插件加 MCP 工具；ai-memory 是容器里跑的 MCP 服务；SpecStory 是编辑器扩展加命令行，把对话存成 Markdown。三者都没有给人看的项目现场页面。

来源：code.claude.com/docs/en/plugins、code.claude.com/docs/en/hooks、cursor.com/docs/hooks、cursor.com/docs/mcp、developers.openai.com/codex、各项目的 GitHub 页面（2026-09-13 查阅）。

## 路线

| 版本 | 形态 |
|---|---|
| MVP | 本地网页 + 命令行 + MCP 连接器 |
| 下一版 | Claude Code 插件：一条命令装好 MCP，外加可选的会话结束钩子，自动同步 |
| 下一版 | Gemini 浏览器扩展（需求 F03 的 P1），代替手动粘贴 |
