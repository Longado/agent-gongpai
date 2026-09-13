// 扩展里内容脚本和后台共用的小工具。不依赖浏览器接口，测试里直接跑。
(function (g) {
  /** Gemini 对话的编号：/app/<编号>，多账号时是 /u/1/app/<编号>。新对话页（还没编号）返回 null。 */
  function conversationKey(url) {
    try {
      const u = new URL(url);
      if (u.hostname !== 'gemini.google.com') return null;
      const m = u.pathname.match(/\/app\/([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  /** 页面内容的指纹：条数加最后一条的内容。变了才需要同步。 */
  function signature(turns) {
    const last = turns[turns.length - 1];
    return `${turns.length}|${last ? last.role + ':' + last.text.length + ':' + last.text.slice(-40) : ''}`;
  }

  /** 要不要自动同步：对话已绑定项目、Gemini 不在生成中、内容和上次同步时不一样、确实读到了消息。 */
  function shouldSync({ bound, generating, turns, lastSignature }) {
    return !!bound && !generating && turns.length > 0 && signature(turns) !== lastSignature;
  }

  g.corpusLib = { conversationKey, signature, shouldSync };
})(typeof self !== 'undefined' ? self : globalThis);
