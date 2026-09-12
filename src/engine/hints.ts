// 结果线索：从任务引用的消息里用规则提取产出的文件、提交编号、链接。不用大模型。
export interface Hints {
  files: string[];
  commits: string[];
  links: string[];
}

const LINK = /https?:\/\/[^\s)\]}>"'，。；、）】]+/g;
// 带斜杠和扩展名的路径，比如 src/export.ts、exports/2026-09.csv
const FILE = /(?:^|[\s`'"(（：:，,])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s`'"),，。；、:：）])/g;
// 7 到 40 位十六进制，且同时含数字和字母，免得把 2026、deadbeef 以外的普通词当成提交
const COMMIT = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;

const uniq = (xs: string[]) => [...new Set(xs)];

export function resultHints(texts: string[]): Hints {
  const links: string[] = [], files: string[] = [], commits: string[] = [];
  for (const raw of texts) {
    links.push(...(raw.match(LINK) ?? []));
    const text = raw.replace(LINK, ' '); // 链接里的路径不重复算成文件
    for (const m of text.matchAll(FILE)) files.push(m[1]);
    commits.push(...(text.replace(FILE, ' ').match(COMMIT) ?? []));
  }
  return { files: uniq(files), commits: uniq(commits), links: uniq(links) };
}
