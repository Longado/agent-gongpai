// 内容脚本：弹窗要读页面时交出已加载的对话；绑定过项目的对话，页面有新消息就交给后台自动补进去。
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'corpus:extract') reply(window.corpusExtract ? window.corpusExtract(document) : { title: '', turns: [], partial: false, url: location.href });
});

// 页面还在生成回复时不同步（开源导出工具的共同判断：发送按钮变成停止按钮）
const generating = () => !!document.querySelector('.send-button.stop, model-response .loading-indicator');

// 页面变化停下来一会儿再判断，免得每个字都触发。2 秒是体验上的等待，不是正确性上的界限
const QUIET_MS = 2000;
let timer = 0;

async function maybeSync() {
  const key = self.corpusLib.conversationKey(location.href);
  if (!key || !window.corpusExtract) return;
  let status;
  try { status = await chrome.runtime.sendMessage({ type: 'corpus:status', key }); } catch { return; } // 扩展刚更新时连接会断
  const page = window.corpusExtract(document);
  if (!self.corpusLib.shouldSync({ bound: status && status.bound, generating: generating(), turns: page.turns, lastSignature: status && status.lastSignature })) return;
  try { await chrome.runtime.sendMessage({ type: 'corpus:sync', page }); } catch { /* 下次页面变化再试 */ }
}

new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(maybeSync, QUIET_MS);
}).observe(document.body, { childList: true, subtree: true, characterData: true });
timer = setTimeout(maybeSync, QUIET_MS);
