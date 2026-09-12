# 交接

最后更新：2026-09-13 01:50。接力时先读这份，再看 `docs/PLAN.md` 的进度表。

## 现在到哪了

- 第 0 到 8 步完成。第 8 步用真实项目 一个真实的个人开发项目 跑通，结论见 `docs/EVAL.md` 的“真实项目对照”。
- 默认模型已改为 `deepseek-flash`，提示词 `evidence-v3`。样本评估 56/56，真实项目约 2 分钟整理完。
- 第 9 步基本完成：暂停采集、发送前同意、使用记录、README 重写（带截图）、演示脚本、形态研判（`docs/FORM.md`）。
- 安全评审已做，两条低危已修。
- 第 10 步 MCP 连接器：子 agent 在 `feat/mcp` 分支、单独的工作目录 上做。它会改 `src/cli.ts`（默认数据库路径改成相对仓库，加 `mcp` 命令）。
- 测试 58 条全绿。

## 下一步（按顺序）

1. 合并 `feat/mcp`：在主线跑 `npm test` 和 `npm run typecheck`，读一遍 `src/mcp.ts`，用示例数据库手动发一次 initialize 和 tools/call 核对输出，再合并推送，删掉工作目录。
2. README 的“现在的状态”和 `docs/FORM.md` 路线表里，把 MCP 从“下一步”改成“已有”，写上注册方法（见 `docs/MCP.md`）。
3. 已知限制记进 README：编排工具派给 worker 的指令会被当成用户的话；Codex 的工具报错暂不读取；子 agent 的会话暂不读取。
4. 演示前准备：用这个仓库自己建项目，按 `docs/DEMO.md` 彩排一次。
5. 下一版候选（MVP 之后）：Claude Code 插件打包、Gemini 浏览器扩展、完成条件自动判定。

## 环境和坑

- 运行：Node 22.18+，`npm run gongpai -- help`。`.env` 放 `DEEPSEEK_API_KEY` 和 `GONGPAI_MODEL`，不提交。
- Claude Code 命令行也可以当模型，但要 `env -u ANTHROPIC_API_KEY`，见 `docs/contracts.md`。
- Node 直接跑 TypeScript，不支持构造函数参数属性、enum 这类要编译的语法（`erasableSyntaxOnly`）。
- 全局 git pre-commit 钩子：同一个提交里既改已有测试文件、又改源码会被拦。新增测试文件不受影响。要改旧测试就单独提交。
- 页面服务只监听 127.0.0.1；写操作必须带 `x-gongpai: 1` 请求头。
- 第一次在页面上同步会弹出“发送说明”，同意后才调用模型；命令行 `extract` 直接整理，会打印一行说明。
