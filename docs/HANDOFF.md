# 交接

最后更新：2026-09-13（第 16 轮后）。接力时先读这份，再看 `docs/PLAN.md` 的进度表。

## 现在到哪了

项目已改名 **Working Corpus**（原名 Agent 工牌），仓库 `Longado/working-corpus`，**公开**。git 已配置匿名邮箱。

- MVP（第 0 到 10 步）完成：读取、整理、引擎、网页、命令行、MCP 连接器。
- 第 11 轮完成：重新整理（保留修正和任务编号）、移出误归类会话、工具版本。
- 第 12 轮完成：前端改成 ThreeUI 风格的深色控制台界面，新增语料带；像素 logo 在 `web/logo.svg`。
- 第 13 轮完成：拆分任务、结果线索（`src/engine/hints.ts`）、续接上下文导出 Markdown。
- 第 22 轮完成：下一步的前置条件（`src/engine/next.ts`）。失败引起的状态说明统一以“失败”开头。
- 第 21 轮完成：Gemini 扩展自动同步（`extension/background.js`、`lib.js`）；有链接的导入按链接认会话。需求文档 v0.2 的 P0、P1 全部完成。
- 第 20 轮完成：任务可以移到别的项目；来源冲突进待确认（规则见 `docs/contracts.md`）；数据库事务改成可重入；示例数据的会话编号加了项目前缀。
- 第 19 轮完成：Gemini 浏览器扩展（`extension/`，见 `docs/EXTENSION.md`）。需求文档 v0.2 的全部 P0 到此补齐。
- 第 18 轮完成：VS Code 自带聊天（`src/ingest/vscode.ts`）。用户在 VS Code 里主要用 Claude Code、Codex 扩展，这两个本来就覆盖；自带聊天本机几乎是空的，解析在真实文件上验证过。
- 第 17 轮完成：用用户的真实 Takeout 校准。那份导出里没有网页版聊天（没勾“我的活动 → Gemini Apps”），只有 Gemini in Workspace 的 3 段对话，照真实结构新增解析；zip 包和文件夹可以直接导入。真实导出只在本机临时目录解析，没有进仓库。
- 第 16 轮完成：Google Takeout 的 Gemini 历史导入（`src/ingest/takeout.ts`；命令行 `takeout`；接入设置页）。字段结构按三份公开资料写成，**没有用真实导出验证**。
- 第 15 轮完成：Claude Code 插件（`.claude-plugin/`、`plugin/`、`bin/corpus`），见 `docs/PLUGIN.md`。
- 第 14 轮完成：导入原页面链接、决定“已被替代”（提示词 `evidence-v4`，新增样本 S7）、打开页面自动只读同步。
- 数据和配置默认在 `~/.working-corpus/`（`CORPUS_HOME`、`CORPUS_DB` 可改）；密钥读取顺序：环境变量 > 仓库 `.env` > `~/.working-corpus/.env`。
- 测试 113 条全绿；样本评估七个样本 61/61。需求差距和轮次安排见 `docs/REQUIREMENTS-GAP.md`。

## 下一步

需求文档 v0.2 的 P0 全部完成，P1 里只剩 Gemini 后台自动同步。之后按价值排：

1. 真实使用：用户自己的项目跑一到两周，看接入设置里的使用记录（打开、复制、修正次数）。修正次数高的地方就是提示词或引擎该改的地方。
2. 网页版 Gemini 的 Takeout 格式：用户在 Takeout 勾“我的活动 → Gemini Apps”（JSON）导一份，校准解析。
3. 扩展在登录后的真实 Gemini 页面上点一次，核对条数；页面改版就改 `extension/extract.js` 的选择器。
4. 以后：消息编辑版本、下一步的“前置条件”。

## 环境和坑

- 运行：Node 22.18+，`npm run corpus -- help`。`.env` 放 `DEEPSEEK_API_KEY` 和 `CORPUS_MODEL`，不提交。
- 仓库是公开的：提交前 `git diff --cached | grep -iE "sk-|/Users/|@gmail"` 自检，别把真实对话、个人路径、私人项目名写进文档。
- Claude Code 命令行也可以当模型，但要 `env -u ANTHROPIC_API_KEY`，见 `docs/contracts.md`。
- Node 直接跑 TypeScript，不支持构造函数参数属性、enum 这类要编译的语法（`erasableSyntaxOnly`）。
- 全局 git pre-commit 钩子：同一个提交里既改已有测试文件、又改源码会被拦。新增测试文件不受影响。要改旧测试就单独提交。
- 页面服务只监听 127.0.0.1；写操作必须带 `x-corpus: 1` 请求头。
- 第一次在页面上同步会弹出“发送说明”，同意后才调用模型；命令行 `extract` 直接整理，会打印一行说明。
