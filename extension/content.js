// 内容脚本：弹窗问一声，就把当前页面已加载的对话读出来交回去。
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'corpus:extract') reply(window.corpusExtract ? window.corpusExtract(document) : { title: '', turns: [], partial: false, url: location.href });
});
