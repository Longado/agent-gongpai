// 弹窗：列出本机的项目，把内容脚本读到的对话发给本地服务的粘贴导入接口。
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let page = null;

async function serverBase() {
  const v = $('server').value.trim().replace(/\/$/, '');
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(v) ? v : null;
}

async function loadProjects() {
  const base = await serverBase();
  if (!base) { $('status').innerHTML = '<span class="err">服务地址只能是本机 127.0.0.1</span>'; return; }
  try {
    const r = await fetch(`${base}/api/state`);
    const s = await r.json();
    const saved = (await chrome.storage.local.get('lastProject')).lastProject;
    $('project').innerHTML = s.projects.map((p) => `<option value="${esc(p.id)}" ${p.id === saved ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    if (!s.projects.length) $('status').innerHTML = '<span class="err">本机还没有项目，先在 Working Corpus 里建一个</span>';
  } catch {
    $('status').innerHTML = '<span class="err">连不上本机服务。先运行 corpus serve</span>';
  }
}

async function readPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/gemini\.google\.com\//.test(tab.url || '')) { $('status').innerHTML = '<span class="err">请在 gemini.google.com 的对话页面上使用</span>'; return; }
  try {
    page = await chrome.tabs.sendMessage(tab.id, { type: 'corpus:extract' });
  } catch {
    $('status').innerHTML = '<span class="err">页面还没加载好，刷新后再试</span>'; return;
  }
  if (!page.turns.length) { $('status').innerHTML = '<span class="err">没有读到消息。可能页面改版了，请粘贴导入</span>'; return; }
  $('status').innerHTML = `当前页面已加载 ${page.turns.length} 条消息${page.partial ? '<span class="warn">，更早的还没加载，只会导入已加载的部分</span>' : ''}`;
  $('go').disabled = false;
  await showBinding();
}

// 这段对话绑定到哪个项目、自动同步的情况
async function showBinding() {
  const key = page && self.corpusLib.conversationKey(page.url);
  const b = key && ((await chrome.storage.local.get('bindings')).bindings || {})[key];
  if (!b) { $('bound').textContent = ''; return; }
  const when = b.lastSyncAt ? new Date(b.lastSyncAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '还没有';
  $('bound').innerHTML = `已绑定到「${esc(b.projectName)}」，自动同步中 · 上次 ${esc(when)}${b.lastNew != null ? `，补了 ${b.lastNew} 条` : ''}${b.lastError ? ` · <span class="err">${esc(b.lastError)}</span>` : ''} · <a href="#" id="unbind">停止自动同步</a>`;
  $('unbind').addEventListener('click', async (e) => {
    e.preventDefault();
    const all = (await chrome.storage.local.get('bindings')).bindings || {};
    delete all[key];
    await chrome.storage.local.set({ bindings: all });
    $('bound').textContent = '已停止自动同步，已经加入的内容保留';
  });
}

$('go').addEventListener('click', async () => {
  const base = await serverBase();
  if (!base || !page) return;
  $('go').disabled = true;
  const text = page.turns.map((t) => `${t.role === 'user' ? '你' : 'Gemini'}：${t.text}`).join('\n');
  const body = { text, label: 'Gemini 网页', title: page.title || '未命名对话', partial: page.partial, url: page.url };
  try {
    const r = await fetch(`${base}/api/projects/${encodeURIComponent($('project').value)}/import`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-corpus': '1' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `失败（${r.status}）`);
    await chrome.storage.local.set({ lastProject: $('project').value });
    const key = self.corpusLib.conversationKey(page.url);
    if ($('auto').checked && key) {
      const all = (await chrome.storage.local.get('bindings')).bindings || {};
      all[key] = { projectId: $('project').value, projectName: $('project').selectedOptions[0]?.textContent || '', server: base, lastSignature: self.corpusLib.signature(page.turns), lastSyncAt: new Date().toISOString(), lastNew: d.newMessages, lastError: null };
      await chrome.storage.local.set({ bindings: all });
      await showBinding();
    }
    $('result').textContent = `已加入：新消息 ${d.newMessages} 条${d.newMessages === 0 ? '（这段之前导入过）' : ''}。回到 Working Corpus 点"同步"整理。`;
  } catch (e) {
    $('result').innerHTML = `<span class="err">${esc(e.message)}</span>`;
    $('go').disabled = false;
  }
});

$('server').addEventListener('change', loadProjects);
loadProjects();
readPage();
