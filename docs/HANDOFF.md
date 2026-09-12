# 交接

最后更新：2026-09-13 02:10。接力时先读这份，再看 `docs/PLAN.md` 的进度表。

## 现在到哪了

**MVP 已落地**：第 0 到 10 步全部完成，测试 68 条全绿。

- 读取：Claude Code、Codex 会话文件，粘贴导入网页 AI 对话。
- 整理：`deepseek-flash` + 提示词 `evidence-v3`，样本评估 56/56；真实项目 74 条消息约 2 分钟。
- 引擎：状态、规划版本、决定、下一步、续接上下文，全部代码计算，硬红线有单测。
- 界面：本地网页（概览、任务、规划、待确认、接入设置、原文侧栏、继续浮层），命令行，MCP 连接器（`docs/MCP.md`）。
- 数据控制：暂停采集、删除项目、发送前同意、凭证替换、使用记录。
- 文档：README（产品向，带截图）、PLAN、contracts、EVAL、FORM、DEMO、MCP。

## 下一步（MVP 之后，按价值排）

1. 演示准备：用这个仓库自己建项目，按 `docs/DEMO.md` 彩排一次；MCP 在 Claude Code 里注册后，现场演示“看现场、按续接上下文继续”。
2. 找 3 到 5 个真实用户试用三个工作日，看 `接入设置` 里的使用记录（打开、复制、修正次数）。
3. 下一版候选：Claude Code 插件打包（一条命令装好 MCP 和会话结束钩子）、Gemini 浏览器扩展、完成条件自动判定、编排工具派发消息的识别。

## 环境和坑

- 运行：Node 22.18+，`npm run gongpai -- help`。`.env` 放 `DEEPSEEK_API_KEY` 和 `GONGPAI_MODEL`，不提交。
- Claude Code 命令行也可以当模型，但要 `env -u ANTHROPIC_API_KEY`，见 `docs/contracts.md`。
- Node 直接跑 TypeScript，不支持构造函数参数属性、enum 这类要编译的语法（`erasableSyntaxOnly`）。
- 全局 git pre-commit 钩子：同一个提交里既改已有测试文件、又改源码会被拦。新增测试文件不受影响。要改旧测试就单独提交。
- 页面服务只监听 127.0.0.1；写操作必须带 `x-gongpai: 1` 请求头。
- 第一次在页面上同步会弹出“发送说明”，同意后才调用模型；命令行 `extract` 直接整理，会打印一行说明。
