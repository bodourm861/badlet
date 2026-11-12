import { sb, configured } from './supa.js';
import { h, clear, modal, toast, errMsg, busy, field } from './ui.js';
import { renderHome, renderTeacherAuth, renderJoin, renderSetupNeeded } from './views/entry.js';
import { renderDashboard } from './views/dashboard.js';
import { renderBoard } from './views/board.js';
import { renderMonitor } from './views/monitor.js';

const app = document.getElementById('app');
let cleanup = null;

async function route() {
  const hash = location.hash || '#/';
  if (/access_token=|error_description=|type=recovery/.test(hash)) {
    // Coming back from an email link (confirm account / reset password).
    const recovery = /type=recovery/.test(hash);
    const err = /error_description=([^&]+)/.exec(hash);
    if (configured) await sb.auth.getSession();
    history.replaceState(null, '', location.pathname + '#/dashboard');
    if (err) toast(decodeURIComponent(err[1].replace(/\+/g, ' ')), 'error');
    if (recovery) showNewPassword();
    return route();
  }
  if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
  document.querySelectorAll('.pop-menu').forEach((m) => m.remove());
  clear(app);
  window.scrollTo(0, 0);
  if (!configured) { renderSetupNeeded(app); return; }

  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (parts[0] === 'teacher') cleanup = await renderTeacherAuth(app);
    else if (parts[0] === 'dashboard') cleanup = await renderDashboard(app);
    else if (parts[0] === 't' && parts[1] && parts[2] === 'monitor') cleanup = await renderMonitor(app, parts[1]);
    else if (parts[0] === 't' && parts[1]) cleanup = await renderBoard(app, { boardId: parts[1], asTeacher: true });
    else if (parts[0] === 'b' && parts[1]) cleanup = await renderJoin(app, parts[1]);
    else cleanup = await renderHome(app);
  } catch (e) {
    console.error(e);
    clear(app).appendChild(h('div', { class: 'center-card' },
      h('div', { class: 'big-emoji' }, '😕'),
      h('h1', null, 'Something went wrong'),
      h('p', null, errMsg(e)),
      h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Try again')));
  }
}

window.addEventListener('hashchange', route);

if (configured) {
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY' && !document.querySelector('.modal [autocomplete=new-password]')) showNewPassword();
  });
}

function showNewPassword() {
  const pw = h('input', { class: 'input', type: 'password', minlength: 8, autocomplete: 'new-password' });
  const btn = h('button', { class: 'btn btn-primary', onclick: async () => {
    if (pw.value.length < 8) { toast('Use at least 8 characters', 'error'); return; }
    busy(btn, true);
    const { error } = await sb.auth.updateUser({ password: pw.value });
    busy(btn, false);
    if (error) toast(errMsg(error), 'error'); else { toast('Password changed ✅', 'ok'); m.close(); route(); }
  } }, 'Save new password');
  const m = modal({ title: 'Choose a new password', size: 'small', body: field('New password (8+ characters)', pw), actions: [btn] });
}

route();
