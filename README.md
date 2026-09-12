# Agent 工牌

你继续在 Claude Code、Codex、网页 AI 里干活。回来时打开工牌，看到一页有证据的项目现场：最初想做什么、现在的计划、每个任务到哪一步、卡在哪、下一步做什么。点"继续"复制一段背景，贴进任何 AI 工具接着干。

每条结论都能点回原话。AI 说做完了只算待验证，你确认了才算完成。

## 先看看

需要 Node 22.18 或更新版本，不需要构建。

```
npm install
npm run gongpai -- demo      # 用样本数据建两个示例项目，不调用模型
npm run gongpai -- serve     # 打开 http://127.0.0.1:4173
```

## 用在自己的项目上

```
cp .env.example .env                                   # 填 DEEPSEEK_API_KEY
npm run gongpai -- project add "项目名" --dir /你的/代码目录 --goal "一句话目标"
npm run gongpai -- serve                               # 在页面上点"同步"
```

- 只读取绑定目录下的 Claude Code 和 Codex 对话，别的目录一概不读。
- 网页 AI 的对话在"接入设置"里粘贴导入。
- 第一次整理前会说明发送什么内容，同意后才发给远程模型；读取时已把像密钥的内容替换掉。
- 数据都存在本机 `data/gongpai.db`。可以暂停采集，也可以删除项目。

命令行也能用：`npm run gongpai -- help`。

## 开发

```
npm test                     # 单元测试，不调用模型
npm run typecheck
npm run gongpai -- eval      # 用真模型跑六个样本，硬红线有一条没过就返回失败
```

- `docs/PLAN.md`：MVP 开发计划
- `docs/contracts.md`：各模块之间的约定和状态规则
- `docs/EVAL.md`：每次改提示词或换模型的评估记录
- `docs/DEMO.md`：演示脚本
- `prompts/evidence.md`：唯一的提示词，文件头有版本号
