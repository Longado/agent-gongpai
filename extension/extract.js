// 从 Gemini 页面（gemini.google.com）的 DOM 里取出已加载的对话。
// 选择器来自 2026-09 时四个开源导出工具的共同用法：user-query / model-response 自定义元素。
// 页面改版后这里会失效，届时弹窗会显示"没有读到消息"，不会读错。
// 这个文件同时被内容脚本和测试页加载，只定义 window.corpusExtract，不做别的。
(function () {
  const clean = (el) => (el ? el.innerText.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '');

  function extract(root) {
    const doc = root || document;
    const nodes = [...doc.querySelectorAll('user-query, model-response')];
    const turns = [];
    for (const n of nodes) {
      if (n.tagName.toLowerCase() === 'user-query') {
        const text = clean(n.querySelector('.query-text') || n);
        if (text) turns.push({ role: 'user', text });
      } else {
        const body = n.querySelector('message-content .markdown') || n.querySelector('.markdown') || n.querySelector('message-content');
        const text = clean(body);
        if (text) turns.push({ role: 'assistant', text });
      }
    }
    const titleEl = doc.querySelector('.conversation.selected .conversation-title') || doc.querySelector('[data-test-id="conversation-title"]');
    const title = clean(titleEl) || (turns.find((t) => t.role === 'user')?.text.slice(0, 40) ?? '');
    // 页面用无限滚动，往上滚还能加载更早的消息。只要顶部不是第一条，就当作"部分"
    const scroller = doc.querySelector('infinite-scroller') || doc.querySelector('.chat-history-scroll-container');
    const partial = !!(scroller && scroller.scrollTop > 0) || !!doc.querySelector('.load-more, [data-test-id="load-earlier"]');
    return { title, turns, partial, url: doc.location ? doc.location.href : '' };
  }

  if (typeof window !== 'undefined') window.corpusExtract = extract;
})();
