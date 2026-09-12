// 发给模型之前、写进数据库之前，把像凭证的内容替换掉。需求 F08：凭证不进记忆。
// ponytail: 只覆盖常见格式，漏网的靠用户删除原始记录；需要时换成专门的密钥扫描库。
const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/g, // OpenAI、DeepSeek、Anthropic 风格
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g, // Slack
  /((?:api[_-]?key|secret|token|password)\s*[:=]\s*)["']?[^\s"']{8,}/gi,
];

export const REDACTED = '[已隐藏的凭证]';

export function redact(text: string): string {
  return PATTERNS.reduce(
    (acc, re) => acc.replace(re, (m, prefix) => (typeof prefix === 'string' && m.startsWith(prefix) ? prefix + REDACTED : REDACTED)),
    text,
  );
}
