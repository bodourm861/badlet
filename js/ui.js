// Small UI toolkit: safe element builder, modals, toasts, helpers.
// All user text goes through text nodes (never innerHTML), which prevents script injection.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'html') { /* intentionally unsupported */ }
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function toast(msg, type = 'info') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(box); }
  const t = h('div', { class: `toast toast-${type}` }, msg);
  box.appendChild(t);
  setTimeout(() => t.classList.add('hide'), 3200);
  setTimeout(() => t.remove(), 3700);
}

export function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || 'Something went wrong');
  if (/row-level security|permission denied/i.test(m)) return 'You are not allowed to do that.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No connection. Check the internet and try again.';
  if (/mime type|invalid_mime/i.test(m)) return 'That kind of file is not allowed.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'That file is too big.';
  return m.replace(/^ERROR:\s*/, '');
}

const openModals = [];
export function modal({ title, body, actions = [], size = '', onClose, className = '' }) {
  const prevFocus = document.activeElement;
  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    openModals.splice(openModals.indexOf(api), 1);
    if (!openModals.length) document.body.classList.remove('modal-open');
    onClose && onClose();
    prevFocus && prevFocus.focus && prevFocus.focus();
  };
  const footer = actions.length ? h('div', { class: 'modal-actions' }, actions) : null;
  const box = h('div', { class: `modal ${size} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
    h('div', { class: 'modal-head' },
      h('h2', null, title || ''),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'modal-body' }, body),
    footer);
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => { if (e.target === backdrop) backdrop.dataset.down = '1'; },
    onclick: (e) => { if (e.target === backdrop && backdrop.dataset.down) close(); delete backdrop.dataset.down; } }, box);
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
  const api = { close, el: box, body: box.querySelector('.modal-body'), setActions(list) { clear(footer); append(footer, list); } };
  openModals.push(api);
  setTimeout(() => { const f = box.querySelector('input:not([type=hidden]),textarea,select'); f ? f.focus() : box.querySelector('.icon-btn').focus(); }, 30);
  return api;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openModals.length) openModals[openModals.length - 1].close();
});
export function closeAllModals() { [...openModals].reverse().forEach((m) => m.close()); }

export function confirmBox(message, { okText = 'Yes', danger = false, typeToConfirm = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = typeToConfirm ? h('input', { class: 'input', placeholder: `Type ${typeToConfirm}` }) : null;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => {
      if (input && input.value.trim().toUpperCase() !== typeToConfirm.toUpperCase()) { input.classList.add('shake'); return; }
      finish(true);
    } }, okText);
    const m = modal({ title: 'Please confirm', size: 'small',
      body: [h('p', { class: 'confirm-text' }, message), input && h('p', { class: 'muted' }, `To confirm, type ${typeToConfirm} below.`), input],
      actions: [h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'), ok],
      onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function toggle(label, checked, onchange, hint) {
  const input = h('input', { type: 'checkbox', checked, onchange: (e) => onchange && onchange(e.target.checked) });
  return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }),
    h('span', { class: 'toggle-text' }, h('strong', null, label), hint ? h('small', null, hint) : null));
}

export function busy(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = text || 'Please wait…'; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text;
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}

export function safeUrl(u) {
  if (!u) return null;
  let s = String(u).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const url = new URL(s); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
}

export function youTubeId(u) {
  try {
    const url = new URL(u);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1).split('/')[0] || null;
    if (url.hostname.includes('youtube.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const m = url.pathname.match(/\/(embed|shorts|live)\/([\w-]{6,})/); return m ? m[2] : null;
    }
  } catch { /* not a URL */ }
  return null;
}
export function vimeoId(u) { try { const url = new URL(u); if (url.hostname.includes('vimeo.com')) { const m = url.pathname.match(/\/(\d{6,})/); return m ? m[1] : null; } } catch { /**/ } return null; }

export function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); }

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function normName(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

export function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function toCSV(rows) {
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

export function menu(anchor, items) {
  document.querySelectorAll('.pop-menu').forEach((m) => m.remove());
  const list = h('div', { class: 'pop-menu', role: 'menu' },
    items.filter(Boolean).map((it) => it === '-' ? h('hr') :
      h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', onclick: (e) => { e.stopPropagation(); list.remove(); it.onClick(); } }, it.label)));
  document.body.appendChild(list);
  const r = anchor.getBoundingClientRect();
  const w = list.offsetWidth, hgt = list.offsetHeight;
  let left = Math.min(r.right - w, window.innerWidth - w - 8); if (left < 8) left = 8;
  let top = r.bottom + 6; if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
  list.style.left = `${left + window.scrollX}px`; list.style.top = `${top + window.scrollY}px`;
  setTimeout(() => {
    const off = (e) => { if (!list.contains(e.target)) { list.remove(); document.removeEventListener('click', off, true); } };
    document.addEventListener('click', off, true);
  }, 0);
  list.querySelector('button')?.focus();
}

export const KIND_INFO = {
  note:     { icon: '📝', label: 'Post' },
  vocab:    { icon: '🔤', label: 'Vocabulary' },
  reading:  { icon: '📖', label: 'Reading' },
  spelling: { icon: '🐝', label: 'Spelling' },
  grammar:  { icon: '🧩', label: 'Grammar' },
  writing:  { icon: '✏️', label: 'Writing' },
  speaking: { icon: '🗣️', label: 'Speaking' },
  activity: { icon: '🎯', label: 'Activity' },
  response: { icon: '📥', label: 'Answer' },
};
export const TASK_KINDS = ['vocab', 'reading', 'spelling', 'grammar', 'writing', 'speaking', 'activity'];
export const LAYOUTS = {
  wall: { icon: '🧱', label: 'Wall' }, grid: { icon: '▦', label: 'Grid' }, shelf: { icon: '🗂️', label: 'Shelf' },
  stream: { icon: '📜', label: 'Stream' }, timeline: { icon: '⏳', label: 'Timeline' },
  canvas: { icon: '🧠', label: 'Canvas' }, storyboard: { icon: '🎬', label: 'Storyboard' },
};
export const THEMES = { sky: 'Sky', mint: 'Mint', peach: 'Peach', lavender: 'Lavender', lemon: 'Lemon', rose: 'Rose' };
export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange', 'white'];

// Redraw a live panel without wiping what the user is typing: if a field inside it
// has focus, wait until they leave it.
export function deferWhileEditing(container, draw) {
  let pending = false;
  const editing = () => {
    const a = document.activeElement;
    if (!a || !container.contains(a) || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
    // only wait if something has been typed in this panel
    return [...container.querySelectorAll('input:not([type=checkbox]):not([type=radio]),textarea')].some((f) => f.value && f.value !== f.defaultValue);
  };
  container.addEventListener('focusout', () => setTimeout(() => { if (pending && container.isConnected && !editing()) { pending = false; draw(); } }, 400));
  return () => { if (!container.isConnected) return; if (editing()) pending = true; else draw(); };
}

// Like el.append(...) but also accepts arrays and skips null/false.
export function add(el, ...kids) { append(el, kids); return el; }
