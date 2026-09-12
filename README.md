# Agent 工牌

你继续在 Claude Code、Codex、网页 AI 里干活。回来时打开工牌，看到一页有证据的项目现场：最初想做什么、现在的计划、每个任务到哪一步、卡在哪、下一步做什么。点"继续"复制一段背景，贴进任何 AI 工具接着干。

每条结论都能点回原话。AI 说做完了只算待验证，你确认了才算完成。

## 运行

需要 Node 22.18 或更新版本。

```
npm install
cp .env.example .env      # 填 DEEPSEEK_API_KEY
npm test
```

## 文档

- `docs/PLAN.md`：MVP 开发计划，每一步的检查方法
- `docs/contracts.md`：各模块之间的约定
- `samples/`：六个样本场景，既是测试也是评估
