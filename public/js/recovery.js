// Refresh recovery bridge. It runs before app.js so the existing registration
// flow can be reused without duplicating game-state logic in the controller.
// The server remains authoritative; localStorage only remembers which session
// should be resumed after a page refresh.
(() => {
  const KEY = 'itb-session-v1';
  const saved = localStorage.getItem(KEY);
  if (!saved) return;

  let session;
  try { session = JSON.parse(saved); } catch { localStorage.removeItem(KEY); return; }
  if (!session?.sessionId) return;

  const originalFetch = window.fetch.bind(window);
  let resumePending = true;
  let resumeData = null;

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET')).toUpperCase();
    if (resumePending && method === 'POST' && url.endsWith('/api/register') && resumeData) {
      resumePending = false;
      return new Response(JSON.stringify({
        sessionId: resumeData.sessionId,
        player: { firstName: resumeData.player.firstName },
        game: resumeData.game,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const response = await originalFetch(input, init);
    if (method === 'POST' && url.endsWith('/api/register') && response.ok) {
      const clone = response.clone();
      clone.json().then((data) => {
        if (data.sessionId) localStorage.setItem(KEY, JSON.stringify({ sessionId: data.sessionId }));
      }).catch(() => {});
    }
    return response;
  };

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const res = await originalFetch(`/api/resume/${encodeURIComponent(session.sessionId)}`);
      if (!res.ok) { localStorage.removeItem(KEY); return; }
      resumeData = await res.json();
      if (resumeData.status === 'completed') { localStorage.removeItem(KEY); return; }
      const first = document.querySelector('#reg-first');
      const surname = document.querySelector('#reg-surname');
      const consent = document.querySelector('#reg-consent');
      const form = document.querySelector('#reg-form');
      if (!first || !surname || !consent || !form) return;
      first.value = resumeData.player.firstName || '';
      surname.value = resumeData.player.surname || '';
      consent.checked = true;
      // Let app.js finish installing its form listener before submitting.
      setTimeout(() => form.requestSubmit(), 0);
    } catch {
      // A failed recovery attempt is non-fatal; the normal registration screen remains usable.
    }
  }, { once: true });
})();
