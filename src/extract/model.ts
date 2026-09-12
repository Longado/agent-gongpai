// 调用大模型。整个项目只有证据整理这一处用到它。
// 测试阶段用 DeepSeek（兼容 OpenAI 的接口），模型版本在 .env 的 GONGPAI_MODEL 里固定。
export interface ModelCall {
  name: string; // 记进每条证据，方便事后追查
  call(system: string, user: string): Promise<string>;
}

export class ModelError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

const TIMEOUT_MS = 300_000; // 推理模型一批要几十秒，给足余量

export function deepseek(opts: { apiKey?: string; model?: string; baseUrl?: string } = {}): ModelCall {
  const apiKey = opts.apiKey ?? process.env.DEEPSEEK_API_KEY;
  const model = opts.model ?? process.env.GONGPAI_MODEL ?? 'deepseek-flash';
  const baseUrl = opts.baseUrl ?? 'https://api.deepseek.com';
  return {
    name: model,
    async call(system, user) {
      if (!apiKey) throw new ModelError('没有配置 DEEPSEEK_API_KEY：复制 .env.example 为 .env 并填写', false);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model, temperature: 0, max_tokens: 8192, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new ModelError(`连不上模型接口：${(e as Error).message}`, true);
      }
      const body = await res.text();
      if (res.status === 401) throw new ModelError('模型接口密钥无效，请检查 DEEPSEEK_API_KEY', false);
      if (res.status === 402) throw new ModelError('模型接口余额不足', false);
      if (res.status === 429 || res.status >= 500) throw new ModelError(`模型接口暂时不可用（${res.status}），稍后重试`, true);
      if (!res.ok) throw new ModelError(`模型接口返回错误（${res.status}）：${body.slice(0, 300)}`, false);
      const choice = JSON.parse(body)?.choices?.[0];
      if (choice?.finish_reason === 'length') throw new ModelError('模型输出被截断（批次太长）', true);
      const content = choice?.message?.content;
      if (typeof content !== 'string') throw new ModelError('模型没有返回内容', true);
      return content;
    },
  };
}
