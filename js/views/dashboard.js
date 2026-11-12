// Teacher dashboard: list, organise, create, edit, duplicate, archive, delete boards.
import { sb, q, currentUser, isTeacherUser } from '../supa.js';
import { h, add, clear, toast, errMsg, menu, confirmBox, LAYOUTS } from '../ui.js';
import { openBoardForm, openShare, deleteBoard } from './boardForm.js';
import { fileUrl } from '../files.js';
import { APP_NAME } from '../config.js';

export function teacherTopbar(user, extra = []) {
  return h('header', { class: 'topbar teacher-bar' },
    h('a', { class: 'logo', href: '#/dashboard' }, '🧸 ', APP_NAME),
    h('div', { class: 'topbar-actions' }, extra,
      h('span', { class: 'who' }, '🍎 ', user.user_metadata?.display_name || user.email),
      h('button', { class: 'btn btn-sm', onclick: async () => { await sb.auth.signOut(); location.hash = '#/'; } }, 'Sign out')));
}

export async function renderDashboard(app) {
  const user = await currentUser();
  if (!isTeacherUser(user)) { location.hash = '#/teacher'; return; }
  let boards = [], counts = {}, showArchived = false, search = '', klass = '';
  const list = h('div', { class: 'board-groups' });
  const classSel = h('select', { class: 'input input-sm', 'aria-label': 'Filter by class', onchange: (e) => { klass = e.target.value; draw(); } });
  const searchInput = h('input', { class: 'input input-sm', type: 'search', placeholder: '🔍 Search boards', oninput: (e) => { search = e.target.value.toLowerCase(); draw(); } });
  const archToggle = h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { showArchived = e.target.checked; draw(); } }), ' Show archived');

  add(app, teacherTopbar(user),
    h('main', { class: 'page' },
      h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'My boards'), h('p', { class: 'muted' }, 'Organised by class and unit.')),
        h('button', { class: 'btn btn-primary btn-lg', onclick: () => openBoardForm(null, { onSaved: (b) => { location.hash = `#/t/${b.id}`; } }) }, '＋ New board')),
      h('div', { class: 'filters' }, searchInput, classSel, archToggle),
      list));

  async function load() {
    boards = await q(sb.from('boards').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }));
    counts = {};
    if (boards.length) {
      const ids = boards.map((b) => b.id);
      const posts = await q(sb.from('posts').select('board_id,status,is_teacher,kind').in('board_id', ids));
      posts.forEach((p) => {
        const c = counts[p.board_id] || (counts[p.board_id] = { pending: 0, student: 0 });
        if (p.status === 'pending') c.pending++;
        if (!p.is_teacher) c.student++;
      });
    }
    const classes = [...new Set(boards.map((b) => b.class_name).filter(Boolean))].sort();
    add(clear(classSel), h('option', { value: '' }, 'All classes'), classes.map((c) => h('option', { value: c, selected: c === klass }, c)));
    draw();
  }

  function draw() {
    clear(list);
    const shown = boards.filter((b) => (showArchived || b.status === 'active') && (!klass || b.class_name === klass) &&
      (!search || `${b.title} ${b.unit} ${b.lesson} ${b.class_name}`.toLowerCase().includes(search)));
    if (!shown.length) {
      add(list, h('div', { class: 'empty' }, h('div', { class: 'big-emoji' }, boards.length ? '🔍' : '🌱'),
        h('p', null, boards.length ? 'No boards match.' : 'You have no boards yet. Click “＋ New board” to make your first one!')));
      return;
    }
    const groups = new Map();
    shown.forEach((b) => {
      const key = `${b.class_name || 'No class'}|||${b.unit || 'Other'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    });
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).forEach(([key, items]) => {
      const [c, u] = key.split('|||');
      items.sort((a, b) => (a.lesson || '').localeCompare(b.lesson || '', undefined, { numeric: true }));
      add(list, h('section', { class: 'board-group' }, h('h2', null, `🏫 ${c}`, h('span', { class: 'muted' }, ` · ${u}`)),
        h('div', { class: 'board-cards' }, items.map(card))));
    });
  }

  function card(b) {
    const c = counts[b.id] || { pending: 0, student: 0 };
    const cover = h('div', { class: `board-cover theme-${b.theme}` }, h('span', { class: 'cover-icon' }, LAYOUTS[b.layout]?.icon || '🧱'));
    if (b.cover_path) fileUrl(b.cover_path).then((u) => { if (u) { cover.style.backgroundImage = `url("${u}")`; cover.classList.add('has-img'); } });
    const more = h('button', { class: 'icon-btn', 'aria-label': 'More actions', onclick: (e) => { e.stopPropagation(); menu(e.currentTarget, [
      { label: '📤 Share link', onClick: () => openShare(b) },
      { label: '📊 Monitor students', onClick: () => { location.hash = `#/t/${b.id}/monitor`; } },
      { label: '✏️ Edit details', onClick: () => openBoardForm(b, { onSaved: load, onDeleted: load }) },
      { label: '📄 Duplicate', onClick: async () => {
        try { await q(sb.rpc('duplicate_board', { p_board: b.id })); toast('Board copied (without student work) ✅', 'ok'); load(); } catch (er) { toast(errMsg(er), 'error'); }
      } },
      { label: b.status === 'active' ? '📦 Archive' : '♻️ Restore', onClick: async () => {
        if (b.status === 'active' && !(await confirmBox('Archive this board? Students will not be able to open or post on it until you restore it.', { okText: 'Archive' }))) return;
        try { await q(sb.from('boards').update({ status: b.status === 'active' ? 'archived' : 'active' }).eq('id', b.id)); load(); } catch (er) { toast(errMsg(er), 'error'); }
      } },
      '-',
      { label: '🗑️ Delete', danger: true, onClick: async () => { if (await deleteBoard(b)) load(); } },
    ]); } }, '⋯');
    return h('article', { class: `board-card ${b.status !== 'active' ? 'archived' : ''}`, tabindex: 0,
      onclick: () => { location.hash = `#/t/${b.id}`; }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/t/${b.id}`; } },
      cover,
      h('div', { class: 'board-card-body' },
        h('div', { class: 'row space' }, h('h3', null, b.title), more),
        h('p', { class: 'muted small' }, [b.subject, b.lesson].filter(Boolean).join(' · ')),
        h('div', { class: 'chips' },
          h('span', { class: 'chip' }, `${LAYOUTS[b.layout]?.icon || ''} ${LAYOUTS[b.layout]?.label || b.layout}`),
          h('span', { class: 'chip' }, `📝 ${c.student} student posts`),
          c.pending ? h('span', { class: 'chip chip-warn' }, `⏳ ${c.pending} waiting`) : null,
          b.status !== 'active' ? h('span', { class: 'chip' }, '📦 Archived') : null)));
  }

  try { await load(); } catch (e) { toast(errMsg(e), 'error'); }
}
