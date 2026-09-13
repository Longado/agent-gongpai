# 交接

最后更新：2026-09-13（第 16 轮后）。接力时先读这份，再看 `docs/PLAN.md` 的进度表。

## 现在到哪了

项目已改名 **Working Corpus**（原名 Agent 工牌），仓库 `Longado/working-corpus`，**公开**。git 已配置匿名邮箱。

- MVP（第 0 到 10 步）完成：读取、整理、引擎、网页、命令行、MCP 连接器。
- 第 11 轮完成：重新整理（保留修正和任务编号）、移出误归类会话、工具版本。
- 第 12 轮完成：前端改成 ThreeUI 风格的深色控制台界面，新增语料带；像素 logo 在 `web/logo.svg`。
- 第 13 轮完成：拆分任务、结果线索（`src/engine/hints.ts`）、续接上下文导出 Markdown。
- 第 16 轮完成：Google Takeout 的 Gemini 历史导入（`src/ingest/takeout.ts`；命令行 `takeout`；接入设置页）。字段结构按三份公开资料写成，**没有用真实导出验证**。
- 第 15 轮完成：Claude Code 插件（`.claude-plugin/`、`plugin/`、`bin/corpus`），见 `docs/PLUGIN.md`。
- 第 14 轮完成：导入原页面链接、决定“已被替代”（提示词 `evidence-v4`，新增样本 S7）、打开页面自动只读同步。
- 数据和配置默认在 `~/.working-corpus/`（`CORPUS_HOME`、`CORPUS_DB` 可改）；密钥读取顺序：环境变量 > 仓库 `.env` > `~/.working-corpus/.env`。
- 测试 92 条全绿；样本评估七个样本 61/61。需求差距和轮次安排见 `docs/REQUIREMENTS-GAP.md`。

## 下一步（每次接力跑两轮）

需求文档 v0.2 的 P0 项已经补齐，剩下的见 `docs/REQUIREMENTS-GAP.md`。下一版按价值排：

1. **Takeout 真实导出验证**：需要用户提供一份自己的 MyActivity.json（只选 Gemini Apps）。拿到后对照解析结果修正字段，把一段脱敏后的真实结构补进测试样本。这一步要用户参与。
2. **Gemini 浏览器扩展**：在 Gemini 页面上点一下，把当前已加载的对话发给本地服务（`/api/projects/:id/import`，带原页面链接、覆盖范围）。Chrome 扩展用 Manifest V3，本地服务要允许扩展的来源访问；测试用 Chrome 的“加载已解压的扩展”，不装到用户的日常浏览器配置里。
3. **Cursor 读取**：Cursor 钩子带会话记录路径，但本机没装 Cursor，格式没见过，先调研。
4. 以后：把任务移到别的项目、来源冲突展示、消息编辑版本、下一步的“前置条件”。

## 环境和坑

- 运行：Node 22.18+，`npm run corpus -- help`。`.env` 放 `DEEPSEEK_API_KEY` 和 `CORPUS_MODEL`，不提交。
- 仓库是公开的：提交前 `git diff --cached | grep -iE "sk-|/Users/|@gmail"` 自检，别把真实对话、个人路径、私人项目名写进文档。
- Claude Code 命令行也可以当模型，但要 `env -u ANTHROPIC_API_KEY`，见 `docs/contracts.md`。
- Node 直接跑 TypeScript，不支持构造函数参数属性、enum 这类要编译的语法（`erasableSyntaxOnly`）。
- 全局 git pre-commit 钩子：同一个提交里既改已有测试文件、又改源码会被拦。新增测试文件不受影响。要改旧测试就单独提交。
- 页面服务只监听 127.0.0.1；写操作必须带 `x-corpus: 1` 请求头。
- 第一次在页面上同步会弹出“发送说明”，同意后才调用模型；命令行 `extract` 直接整理，会打印一行说明。
