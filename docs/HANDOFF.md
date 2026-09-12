# 交接

最后更新：2026-09-13 02:10（第 12 轮后）。接力时先读这份，再看 `docs/PLAN.md` 的进度表。

## 现在到哪了

项目已改名 **Working Corpus**（原名 Agent 工牌），仓库 `Longado/working-corpus`，**公开**。git 已配置匿名邮箱。

- MVP（第 0 到 10 步）完成：读取、整理、引擎、网页、命令行、MCP 连接器。
- 第 11 轮完成：重新整理（保留修正和任务编号）、移出误归类会话、工具版本。
- 第 12 轮完成：前端改成 ThreeUI 风格的深色控制台界面，新增语料带；像素 logo 在 `web/logo.svg`。
- 数据和配置默认在 `~/.working-corpus/`（`CORPUS_HOME`、`CORPUS_DB` 可改）；密钥读取顺序：环境变量 > 仓库 `.env` > `~/.working-corpus/.env`。
- 测试 74 条全绿。需求差距和轮次安排见 `docs/REQUIREMENTS-GAP.md`。

## 下一步（每次接力跑两轮）

1. **第 13 轮 任务层**：
   - 任务详情里列出这个任务的证据，勾选后“拆成新任务”（用已有的 `new_task` 和 `assign` 修正实现）。
   - 结果线索：从任务证据引用的消息里，用正则提取文件路径、提交编号（7 到 40 位十六进制）、链接，在任务详情显示，不用大模型。
   - 继续浮层加“导出 Markdown”：浏览器里生成文件下载。
2. **第 14 轮 来源与决定**：
   - 粘贴导入可以填原页面链接，会话记下链接，原文侧栏显示“打开原页面”。
   - 决定“已被替代”：提示词 v4 让模型在新决定推翻旧决定时给出被替代的决定，引擎标记；改完跑 `npm run corpus -- eval`，结果记进 `docs/EVAL.md`。
   - 打开页面时自动读取新对话（只读不整理），概览显示“还有多少条没整理”。
3. 以后：Claude Code 插件打包、Gemini 浏览器扩展和 Takeout 导入、Cursor。

## 环境和坑

- 运行：Node 22.18+，`npm run corpus -- help`。`.env` 放 `DEEPSEEK_API_KEY` 和 `CORPUS_MODEL`，不提交。
- 仓库是公开的：提交前 `git diff --cached | grep -iE "sk-|/Users/|@gmail"` 自检，别把真实对话、个人路径、私人项目名写进文档。
- Claude Code 命令行也可以当模型，但要 `env -u ANTHROPIC_API_KEY`，见 `docs/contracts.md`。
- Node 直接跑 TypeScript，不支持构造函数参数属性、enum 这类要编译的语法（`erasableSyntaxOnly`）。
- 全局 git pre-commit 钩子：同一个提交里既改已有测试文件、又改源码会被拦。新增测试文件不受影响。要改旧测试就单独提交。
- 页面服务只监听 127.0.0.1；写操作必须带 `x-corpus: 1` 请求头。
- 第一次在页面上同步会弹出“发送说明”，同意后才调用模型；命令行 `extract` 直接整理，会打印一行说明。
