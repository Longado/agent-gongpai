// 后台：页面脚本读到新内容后交给这里，由扩展自己的来源转发给本地服务。
// 页面脚本直接请求本地服务会被当成 Gemini 网站的请求，本地服务对网站来源一律拒绝，所以必须经这里转发。
importScripts('lib.js');

async function bindings() {
  return (await chrome.storage.local.get('bindings')).bindings || {};
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || typeof msg.type !== 'string') return false;
  (async () => {
    const all = await bindings();
    if (msg.type === 'corpus:status') {
      const b = all[msg.key];
      return reply({ bound: !!b, lastSignature: b ? b.lastSignature : '' });
    }
    if (msg.type === 'corpus:sync') {
      const page = msg.page;
      const key = self.corpusLib.conversationKey(page.url);
      const b = key && all[key];
      if (!b) return reply({ ok: false, reason: 'unbound' });
      const text = page.turns.map((t) => `${t.role === 'user' ? '你' : 'Gemini'}：${t.text}`).join('\n');
      try {
        const r = await fetch(`${b.server}/api/projects/${encodeURIComponent(b.projectId)}/import`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-corpus': '1' },
          body: JSON.stringify({ text, label: 'Gemini 网页', title: page.title || '未命名对话', partial: page.partial, url: page.url }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `失败（${r.status}）`);
        all[key] = { ...b, lastSignature: self.corpusLib.signature(page.turns), lastSyncAt: new Date().toISOString(), lastNew: d.newMessages, lastError: null };
        await chrome.storage.local.set({ bindings: all });
        return reply({ ok: true, newMessages: d.newMessages });
      } catch (e) {
        all[key] = { ...b, lastError: String(e.message || e) }; // 本地服务没开时记下来，弹窗里能看到
        await chrome.storage.local.set({ bindings: all });
        return reply({ ok: false, reason: 'error' });
      }
    }
    reply({ ok: false });
  })();
  return true; // 异步回复
});
