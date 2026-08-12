// Admin dashboard controller. Bearer token held in memory only (not
// localStorage) so it dies with the tab. All export downloads go through an
// authenticated fetch + Blob so the Authorization header is always sent.
const $ = (s, r = document) => r.querySelector(s);
let TOKEN = null;
let PLAYERS = [];
let sortKey = 'completedAt';
let sortDir = 'desc';

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  return res;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ---- Login ----
function showLogin(msg = '') {
  $('#app').innerHTML = `
    <div class="login">
      <div>
        <div class="eyebrow">Restricted</div>
        <h1 style="font-family:var(--font-macro);font-weight:900;text-transform:uppercase;letter-spacing:-0.03em;font-size:2rem;margin-top:8px">Admin Access</h1>
      </div>
      <form id="login-form">
        <div class="field" style="margin-bottom:16px">
          <label for="u">Operator</label>
          <input id="u" type="text" autocomplete="username" required />
        </div>
        <div class="field" style="margin-bottom:16px">
          <label for="p">Passphrase</label>
          <input id="p" type="password" autocomplete="current-password" required />
        </div>
        <div class="form-error" id="login-error" role="alert">${escapeHtml(msg)}</div>
        <button class="btn btn--block" type="submit" style="margin-top:16px">Authenticate →</button>
      </form>
    </div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = $('#u').value;
    const password = $('#p').value;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        $('#login-error').textContent = data.error || 'Login failed.';
        btn.disabled = false;
        return;
      }
      TOKEN = data.token;
      await showDashboard();
    } catch {
      $('#login-error').textContent = 'Network error. Try again.';
      btn.disabled = false;
    }
  });
  setTimeout(() => $('#u')?.focus(), 80);
}

// ---- Dashboard ----
async function showDashboard() {
  $('#app').innerHTML = `
    <div class="admin-head">
      <h1>Identify the Brand<span class="accent">Admin</span></h1>
      <div class="who">
        <span>SESSION ACTIVE</span>
        <button class="btn btn--ghost" id="logout" style="padding:4px 10px;font-size:10px">Sign out</button>
      </div>
    </div>

    <div class="stats" id="stats">
      <div class="stat"><span class="k">Players</span><span class="v" id="s-players">—</span></div>
      <div class="stat"><span class="k">Completed</span><span class="v" id="s-completed">—</span></div>
      <div class="stat"><span class="k">Avg Score</span><span class="v" id="s-avg">—</span></div>
      <div class="stat"><span class="k">High Score</span><span class="v" id="s-high">—</span></div>
    </div>

    <div class="exports">
      <button class="btn primary" data-export="players">Export Scores ↓</button>
      <button class="btn btn--ghost" data-export="answers">Export Answers</button>
      <button class="btn btn--ghost" data-export="full">Export Full Dataset</button>
      <button class="btn btn--ghost" data-export="raw">Download Raw CSV</button>
      <span class="toast" id="toast"></span>
    </div>

    <div class="filters">
      <span>Filter</span>
      <input id="f-name" type="text" placeholder="name..." />
      <label>min score <input id="f-min" type="number" min="0" style="width:70px" /></label>
      <select id="f-status">
        <option value="">all status</option>
        <option value="completed">completed</option>
      </select>
      <button class="btn btn--ghost" id="f-clear" style="padding:4px 10px;font-size:10px">Clear</button>
    </div>

    <div class="table-wrap">
      <table class="ptable">
        <thead>
          <tr>
            <th data-sort="name">Player</th>
            <th data-sort="score">Score</th>
            <th data-sort="percentage">%</th>
            <th data-sort="completedAt">Date</th>
            <th data-sort="status">Status</th>
          </tr>
        </thead>
        <tbody id="ptable-body"></tbody>
      </table>
    </div>`;

  $('#logout').addEventListener('click', () => {
    TOKEN = null;
    showLogin('Signed out.');
  });

  for (const btn of document.querySelectorAll('[data-export]')) {
    btn.addEventListener('click', () => doExport(btn.dataset.export, btn));
  }
  for (const th of document.querySelectorAll('.ptable th[data-sort]')) {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = key; sortDir = key === 'name' ? 'asc' : 'desc'; }
      renderTable();
    });
  }
  ['#f-name', '#f-min', '#f-status'].forEach((s) =>
    $(s).addEventListener('input', renderTable),
  );
  $('#f-clear').addEventListener('click', () => {
    $('#f-name').value = '';
    $('#f-min').value = '';
    $('#f-status').value = '';
    renderTable();
  });

  await Promise.all([loadStats(), loadPlayers()]);
}

async function loadStats() {
  const res = await apiFetch('/api/admin/stats');
  if (res.status === 401) return sessionExpired();
  const s = await res.json();
  const max = s.totalPossible || 40;
  $('#s-players').textContent = s.players;
  $('#s-completed').textContent = s.completed;
  $('#s-avg').innerHTML = `${s.avgScore}<small> / ${max}</small>`;
  $('#s-high').innerHTML = `${s.highScore}<small> / ${max}</small>`;
}

async function loadPlayers() {
  const res = await apiFetch('/api/admin/players');
  if (res.status === 401) return sessionExpired();
  const data = await res.json();
  PLAYERS = data.players || [];
  renderTable();
}

function renderTable() {
  const nameF = ($('#f-name')?.value || '').toLowerCase();
  const minF = Number($('#f-min')?.value || 0);
  const statusF = $('#f-status')?.value || '';

  let rows = PLAYERS.filter((p) => {
    if (nameF && !p.name.toLowerCase().includes(nameF)) return false;
    if (minF && p.score < minF) return false;
    if (statusF && p.status !== statusF) return false;
    return true;
  });

  rows.sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (typeof av === 'string') { av = av.toLowerCase(); bv = String(bv).toLowerCase(); }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  for (const th of document.querySelectorAll('.ptable th[data-sort]')) {
    th.setAttribute(
      'aria-sort',
      th.dataset.sort === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
    );
  }

  const body = $('#ptable-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="ptable-empty">No matching players.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((p) => {
      const date = p.completedAt ? new Date(p.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
      return `<tr>
        <td>${escapeHtml(p.name)}</td>
        <td class="num">${p.score}/${p.totalPossible}</td>
        <td class="num">${p.percentage}%</td>
        <td>${date}</td>
        <td><span class="status">${escapeHtml(p.status)}</span></td>
      </tr>`;
    })
    .join('');
}

async function doExport(kind, btn) {
  const toast = $('#toast');
  toast.className = 'toast';
  toast.textContent = 'Preparing…';
  btn.disabled = true;
  try {
    const res = await apiFetch(`/api/admin/export/${kind}`);
    if (res.status === 401) return sessionExpired();
    if (!res.ok) throw new Error('Export failed.');
    const blob = await res.blob();
    const disp = res.headers.get('content-disposition') || '';
    const match = disp.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `identify-the-brand-${kind}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.textContent = 'Exported successfully.';
  } catch (err) {
    toast.className = 'toast err';
    toast.textContent = err.message || 'Export failed. Retry.';
  } finally {
    btn.disabled = false;
    setTimeout(() => { if (toast.textContent === 'Exported successfully.') toast.textContent = ''; }, 4000);
  }
}

function sessionExpired() {
  TOKEN = null;
  showLogin('Session expired. Sign in again.');
}

showLogin();
