# 交接

最后更新：2026-09-13 05:40（第 14 轮后）。接力时先读这份，再看 `docs/PLAN.md` 的进度表。

## 现在到哪了

项目已改名 **Working Corpus**（原名 Agent 工牌），仓库 `Longado/working-corpus`，**公开**。git 已配置匿名邮箱。

- MVP（第 0 到 10 步）完成：读取、整理、引擎、网页、命令行、MCP 连接器。
- 第 11 轮完成：重新整理（保留修正和任务编号）、移出误归类会话、工具版本。
- 第 12 轮完成：前端改成 ThreeUI 风格的深色控制台界面，新增语料带；像素 logo 在 `web/logo.svg`。
- 第 13 轮完成：拆分任务、结果线索（`src/engine/hints.ts`）、续接上下文导出 Markdown。
- 第 14 轮完成：导入原页面链接、决定“已被替代”（提示词 `evidence-v4`，新增样本 S7）、打开页面自动只读同步。
- 数据和配置默认在 `~/.working-corpus/`（`CORPUS_HOME`、`CORPUS_DB` 可改）；密钥读取顺序：环境变量 > 仓库 `.env` > `~/.working-corpus/.env`。
- 测试 85 条全绿；样本评估七个样本 61/61。需求差距和轮次安排见 `docs/REQUIREMENTS-GAP.md`。

## 下一步（每次接力跑两轮）

需求文档 v0.2 的 P0 项已经基本补齐，剩下的见 `docs/REQUIREMENTS-GAP.md`。下一版按价值排：

1. **第 15 轮 Claude Code 插件**：仓库根目录加 `.claude-plugin/`（marketplace.json + plugin.json），插件带 MCP 配置、一个“按现场继续”的技能、会话结束时只读同步的钩子。插件缓存里没有 `node_modules`，需要一个启动脚本在缺依赖时先装。只用 `claude --plugin-dir` 一次性加载测试，不改全局配置。
2. **第 16 轮 Google Takeout 导入**：解析 Gemini Apps 活动导出（My Activity），按对话切会话；先用手写的样本文件做测试，格式以官方导出为准，拿不到真实样本就在文档里写明。
3. 以后：Gemini 浏览器扩展、Cursor、把任务移到别的项目、来源冲突展示、消息编辑版本。

## 环境和坑

- 运行：Node 22.18+，`npm run corpus -- help`。`.env` 放 `DEEPSEEK_API_KEY` 和 `CORPUS_MODEL`，不提交。
- 仓库是公开的：提交前 `git diff --cached | grep -iE "sk-|/Users/|@gmail"` 自检，别把真实对话、个人路径、私人项目名写进文档。
- Claude Code 命令行也可以当模型，但要 `env -u ANTHROPIC_API_KEY`，见 `docs/contracts.md`。
- Node 直接跑 TypeScript，不支持构造函数参数属性、enum 这类要编译的语法（`erasableSyntaxOnly`）。
- 全局 git pre-commit 钩子：同一个提交里既改已有测试文件、又改源码会被拦。新增测试文件不受影响。要改旧测试就单独提交。
- 页面服务只监听 127.0.0.1；写操作必须带 `x-corpus: 1` 请求头。
- 第一次在页面上同步会弹出“发送说明”，同意后才调用模型；命令行 `extract` 直接整理，会打印一行说明。
