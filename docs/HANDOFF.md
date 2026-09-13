# 交接

最后更新：2026-09-13（第 16 轮后）。接力时先读这份，再看 `docs/PLAN.md` 的进度表。

## 现在到哪了

项目已改名 **Working Corpus**（原名 Agent 工牌），仓库 `Longado/working-corpus`，**公开**。git 已配置匿名邮箱。

- MVP（第 0 到 10 步）完成：读取、整理、引擎、网页、命令行、MCP 连接器。
- 第 11 轮完成：重新整理（保留修正和任务编号）、移出误归类会话、工具版本。
- 第 12 轮完成：前端改成 ThreeUI 风格的深色控制台界面，新增语料带；像素 logo 在 `web/logo.svg`。
- 第 13 轮完成：拆分任务、结果线索（`src/engine/hints.ts`）、续接上下文导出 Markdown。
- 第 17 轮完成：用用户的真实 Takeout 校准。那份导出里没有网页版聊天（没勾“我的活动 → Gemini Apps”），只有 Gemini in Workspace 的 3 段对话，照真实结构新增解析；zip 包和文件夹可以直接导入。真实导出只在本机临时目录解析，没有进仓库。
- 第 16 轮完成：Google Takeout 的 Gemini 历史导入（`src/ingest/takeout.ts`；命令行 `takeout`；接入设置页）。字段结构按三份公开资料写成，**没有用真实导出验证**。
- 第 15 轮完成：Claude Code 插件（`.claude-plugin/`、`plugin/`、`bin/corpus`），见 `docs/PLUGIN.md`。
- 第 14 轮完成：导入原页面链接、决定“已被替代”（提示词 `evidence-v4`，新增样本 S7）、打开页面自动只读同步。
- 数据和配置默认在 `~/.working-corpus/`（`CORPUS_HOME`、`CORPUS_DB` 可改）；密钥读取顺序：环境变量 > 仓库 `.env` > `~/.working-corpus/.env`。
- 测试 96 条全绿；样本评估七个样本 61/61。需求差距和轮次安排见 `docs/REQUIREMENTS-GAP.md`。

## 下一步（每次接力跑两轮）

需求文档 v0.2 的 P0 项已经补齐，剩下的见 `docs/REQUIREMENTS-GAP.md`。下一版按价值排：

1. **网页版 Gemini 的真实导出验证**：Workspace 格式已校准；网页版要用户在 Takeout 里勾“我的活动 → Gemini Apps”（JSON）再导一次。
2. **Gemini 浏览器扩展**：在 Gemini 页面上点一下，把当前已加载的对话发给本地服务（`/api/projects/:id/import`，带原页面链接、覆盖范围）。Chrome 扩展用 Manifest V3，本地服务要允许扩展的来源访问；测试用 Chrome 的“加载已解压的扩展”，不装到用户的日常浏览器配置里。
3. **VS Code 支持**（用户 9-13 定：不做 Cursor，做 VS Code）：见第 18 轮。
4. 以后：把任务移到别的项目、来源冲突展示、消息编辑版本、下一步的“前置条件”。

## 环境和坑

- 运行：Node 22.18+，`npm run corpus -- help`。`.env` 放 `DEEPSEEK_API_KEY` 和 `CORPUS_MODEL`，不提交。
- 仓库是公开的：提交前 `git diff --cached | grep -iE "sk-|/Users/|@gmail"` 自检，别把真实对话、个人路径、私人项目名写进文档。
- Claude Code 命令行也可以当模型，但要 `env -u ANTHROPIC_API_KEY`，见 `docs/contracts.md`。
- Node 直接跑 TypeScript，不支持构造函数参数属性、enum 这类要编译的语法（`erasableSyntaxOnly`）。
- 全局 git pre-commit 钩子：同一个提交里既改已有测试文件、又改源码会被拦。新增测试文件不受影响。要改旧测试就单独提交。
- 页面服务只监听 127.0.0.1；写操作必须带 `x-corpus: 1` 请求头。
- 第一次在页面上同步会弹出“发送说明”，同意后才调用模型；命令行 `extract` 直接整理，会打印一行说明。
