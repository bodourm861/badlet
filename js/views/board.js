// The board page (teacher and student), its 7 layouts, live updates and live teacher controls.
import { sb, q, currentUser } from '../supa.js';
import { h, add, clear, modal, toast, errMsg, menu, field, confirmBox, LAYOUTS, KIND_INFO, TASK_KINDS, debounce } from '../ui.js';
import { fileUrl } from '../files.js';
import { APP_NAME } from '../config.js';
import { setting, openBoardForm, openShare } from './boardForm.js';
import { renderCard, cardSignature, openPost } from './postcard.js';
import { openComposer, openTeacherEditor } from './composer.js';
import { openActivityEditor } from './activities.js';

export async function renderBoard(app, { boardId, asTeacher }) {
  const user = await currentUser();
  if (!user) { location.hash = asTeacher ? '#/teacher' : '#/'; return; }

  const ctx = {
    uid: user.id, user, board: null, posts: [], comments: [], reactions: [], assessments: [], members: [], roster: [], keys: {}, me: null,
    isOwner: false, preview: false, connectFrom: null, settingsKey: '', filter: 'all',
    get teacherMode() { return this.isOwner && !this.preview; },
  };
  const idx = { byParent: new Map(), comments: new Map(), reacts: new Map(), assess: new Map() };
  const listeners = new Set();
  ctx.onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  ctx.responsesFor = (id) => [...(idx.byParent.get(id) || [])];
  ctx.myResponse = (id) => (idx.byParent.get(id) || []).find((r) => r.author_id === ctx.uid) || null;
  ctx.commentsFor = (id) => idx.comments.get(id) || [];
  ctx.assessmentFor = (id) => idx.assess.get(id) || null;
  ctx.reactSummary = (id) => {
    const list = idx.reacts.get(id) || [];
    const likes = list.filter((r) => r.kind === 'like'), votes = list.filter((r) => r.kind === 'vote'), stars = list.filter((r) => r.kind === 'star');
    return { likes: likes.length, myLike: likes.some((r) => r.user_id === ctx.uid), votes: votes.length, myVote: votes.some((r) => r.user_id === ctx.uid),
      starCount: stars.length, starAvg: stars.length ? stars.reduce((s, r) => s + r.value, 0) / stars.length : 0, myStar: stars.find((r) => r.user_id === ctx.uid)?.value || 0 };
  };
  ctx.boardActive = () => ctx.board.status === 'active' && (ctx.isOwner || !setting(ctx.board, 'posting_locked'));
  ctx.canPostAnything = () => ctx.isOwner || ctx.boardActive();
  ctx.myName = () => ctx.isOwner ? (user.user_metadata?.display_name || 'Teacher') : (ctx.me?.display_name || 'Student');

  // ---------- data ----------
  async function load() {
    const boards = await q(sb.from('boards').select('*').eq('id', boardId));
    if (!boards.length) throw Object.assign(new Error('no-access'), { noAccess: true });
    ctx.board = boards[0];
    ctx.isOwner = ctx.board.owner_id === ctx.uid;
    const tasks = [
      q(sb.from('posts').select('*').eq('board_id', boardId).order('sort_order').limit(5000)),
      q(sb.from('comments').select('*').eq('board_id', boardId).order('created_at').limit(5000)),
      q(sb.from('reactions').select('*').eq('board_id', boardId).limit(10000)),
      q(sb.from('assessments').select('*').eq('board_id', boardId).limit(5000)),
    ];
    if (ctx.isOwner) {
      tasks.push(q(sb.from('board_members').select('*').eq('board_id', boardId)));
      tasks.push(q(sb.from('activity_keys').select('post_id,answers').eq('board_id', boardId)));
      tasks.push(q(sb.from('board_secrets').select('roster').eq('board_id', boardId)));
    } else tasks.push(q(sb.from('board_members').select('*').eq('board_id', boardId).eq('user_id', ctx.uid)));
    const [posts, comments, reactions, assessments, members, keys, secrets] = await Promise.all(tasks);
    Object.assign(ctx, { posts, comments, reactions, assessments, members });
    if (ctx.isOwner) { ctx.keys = Object.fromEntries((keys || []).map((k) => [k.post_id, k.answers])); ctx.roster = secrets?.[0]?.roster || []; }
    else { ctx.me = members[0] || null; if (!ctx.me) throw Object.assign(new Error('no-access'), { noAccess: true }); }
    idx.byParent.clear(); idx.comments.clear(); idx.reacts.clear(); idx.assess.clear();
    posts.forEach((p) => { if (p.parent_id) { if (!idx.byParent.has(p.parent_id)) idx.byParent.set(p.parent_id, []); idx.byParent.get(p.parent_id).push(p); } });
    comments.forEach((c) => { if (!idx.comments.has(c.post_id)) idx.comments.set(c.post_id, []); idx.comments.get(c.post_id).push(c); });
    reactions.forEach((r) => { if (!idx.reacts.has(r.post_id)) idx.reacts.set(r.post_id, []); idx.reacts.get(r.post_id).push(r); });
    assessments.forEach((a) => idx.assess.set(a.post_id, a));
    ctx.settingsKey = JSON.stringify([ctx.board.settings, ctx.board.status, ctx.board.layout, ctx.preview]);
  }

  try { await load(); }
  catch (e) {
    if (e.noAccess) {
      add(app, h('div', { class: 'center-card' }, h('div', { class: 'big-emoji' }, '🚪'), h('h1', null, 'You cannot open this board'),
        h('p', null, asTeacher ? 'This board does not exist or belongs to another teacher.' : 'Your teacher may have removed you, or the board was deleted. Ask your teacher for the link again.'),
        h('a', { class: 'btn', href: asTeacher ? '#/dashboard' : '#/' }, 'Go back')));
      return;
    }
    throw e;
  }
  if (asTeacher && !ctx.isOwner) { location.hash = `#/b/${ctx.board.slug}`; return; }
  if (!asTeacher && ctx.isOwner) { location.hash = `#/t/${boardId}`; return; }

  const root = h('div', { class: 'board-page' });
  const top = h('div', { class: 'board-top' });
  const banners = h('div', { class: 'banners' });
  const area = h('main', { class: 'board-area' });
  const spot = h('div', { class: 'spot-holder' });
  const fab = h('div', { class: 'fab-holder' });
  add(root, top, banners, area, fab, spot);
  add(app, root);

  let refreshing = null, again = false;
  ctx.refresh = async () => {
    if (refreshing) { again = true; return refreshing; }
    refreshing = (async () => {
      try { await load(); render(); }
      catch (e) {
        if (e.noAccess) { add(clear(app), h('div', { class: 'center-card' }, h('div', { class: 'big-emoji' }, '👋'), h('h1', null, 'This board is no longer available'), h('a', { class: 'btn', href: '#/' }, 'Home'))); stop(); return; }
        console.warn(e);
      } finally { refreshing = null; }
      if (again) { again = false; await ctx.refresh(); }
    })();
    return refreshing;
  };
  const soon = debounce(() => ctx.refresh(), 350);

  // ---------- teacher actions ----------
  ctx.spotlight = async (id) => { try { await q(sb.from('boards').update({ spotlight_post_id: id }).eq('id', boardId)); toast(id ? 'Showing on every screen 🖥️' : 'Stopped showing', 'ok'); ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); } };
  ctx.move = async (p, dir) => {
    const list = ordered(visibleTop());
    const i = list.findIndex((x) => x.id === p.id); const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const other = list[j];
    let a = p.sort_order, b = other.sort_order;
    if (a === b) b = a + dir * 0.001;
    try {
      await q(sb.from('posts').update({ sort_order: b }).eq('id', p.id));
      await q(sb.from('posts').update({ sort_order: a }).eq('id', other.id));
      ctx.refresh();
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  ctx.moveToSection = (p) => {
    const sel = h('select', { class: 'input' }, (ctx.board.sections || []).map((s) => h('option', { value: s.id, selected: s.id === p.section_id }, s.title)));
    const m = modal({ title: 'Move to column', size: 'small', body: field('Column', sel), actions: [h('button', { class: 'btn btn-primary', onclick: async () => {
      try { await q(sb.from('posts').update({ section_id: sel.value }).eq('id', p.id)); m.close(); ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); }
    } }, 'Move')] });
  };
  ctx.startConnect = (p) => { ctx.connectFrom = p.id; toast('Now click the card you want to connect to (Esc to cancel)', 'info'); render(); };
  async function finishConnect(target) {
    const src = ctx.posts.find((x) => x.id === ctx.connectFrom);
    ctx.connectFrom = null;
    if (!src || src.id === target.id) { render(); return; }
    const set = new Set(src.connections || []);
    const back = new Set(target.connections || []);
    if (set.has(target.id) || back.has(src.id)) {
      set.delete(target.id); back.delete(src.id);
      await q(sb.from('posts').update({ connections: [...back] }).eq('id', target.id));
    } else set.add(target.id);
    try { await q(sb.from('posts').update({ connections: [...set] }).eq('id', src.id)); ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  const onKey = (e) => { if (e.key === 'Escape' && ctx.connectFrom) { ctx.connectFrom = null; render(); } };
  document.addEventListener('keydown', onKey);

  // ---------- render ----------
  function visibleTop() {
    let list = ctx.posts.filter((p) => !p.parent_id);
    if (!ctx.teacherMode) list = list.filter((p) => p.status === 'approved' || (p.author_id === ctx.uid && !ctx.isOwner) || (ctx.isOwner && p.is_teacher));
    if (ctx.teacherMode && ctx.filter === 'pending') list = list.filter((p) => p.status === 'pending' || ctx.responsesFor(p.id).some((r) => r.status === 'pending'));
    return list;
  }
  function ordered(list) {
    return [...list].sort((a, b) => (b.pinned - a.pinned) || (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at));
  }

  function render() {
    root.className = `board-page theme-${ctx.board.theme || 'sky'} lay-${ctx.board.layout} ${ctx.teacherMode ? 'is-teacher' : 'is-student'}`;
    drawTop(); drawBanners(); drawLayout(); drawFab(); drawSpotlight();
    listeners.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });
  }

  function drawTop() {
    const b = ctx.board;
    const pending = ctx.posts.filter((p) => p.status === 'pending').length;
    clear(top);
    if (ctx.isOwner) {
      const locked = setting(b, 'posting_locked');
      const layoutSel = h('select', { class: 'input input-sm', 'aria-label': 'Layout', onchange: async (e) => {
        try { await q(sb.from('boards').update({ layout: e.target.value }).eq('id', boardId)); toast(`Layout: ${LAYOUTS[e.target.value].label} (nothing was lost)`, 'ok'); ctx.refresh(); } catch (er) { toast(errMsg(er), 'error'); }
      } }, Object.entries(LAYOUTS).map(([k, v]) => h('option', { value: k, selected: k === b.layout }, `${v.icon} ${v.label}`)));
      add(top, h('header', { class: 'topbar teacher-bar' },
        h('a', { class: 'logo', href: '#/dashboard', title: 'Back to my boards' }, '← 🧸'),
        h('div', { class: 'board-title' }, h('h1', null, b.title), h('small', null, [b.class_name, b.unit, b.lesson].filter(Boolean).join(' · '))),
        h('div', { class: 'topbar-actions' },
          ctx.preview ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => { ctx.preview = false; ctx.refresh(); } }, '👀 Exit student view') : [
            h('button', { class: 'btn btn-primary', onclick: (e) => addMenu(e.currentTarget) }, '＋ Add'),
            layoutSel,
            h('button', { class: `btn btn-sm ${locked ? 'btn-closed' : ''}`, title: 'Stop / allow all student posting', onclick: async () => {
              try { await q(sb.from('boards').update({ settings: { ...b.settings, posting_locked: !locked } }).eq('id', boardId)); toast(locked ? 'Students can post again 🔓' : 'Posting paused for students 🔒', 'ok'); ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); }
            } }, locked ? '🔒 Posting paused' : '🔓 Posting open'),
            pending ? h('button', { class: `btn btn-sm ${ctx.filter === 'pending' ? 'btn-primary' : 'chip-warn'}`, onclick: () => { ctx.filter = ctx.filter === 'pending' ? 'all' : 'pending'; render(); } }, `⏳ ${pending} waiting`) : null,
            b.spotlight_post_id ? h('button', { class: 'btn btn-sm', onclick: () => ctx.spotlight(null) }, '🖥️ Stop showing') : null,
            h('button', { class: 'btn btn-sm', onclick: () => openShare(b) }, '📤 Share'),
            h('a', { class: 'btn btn-sm', href: `#/t/${boardId}/monitor` }, '📊 Monitor'),
            h('button', { class: 'btn btn-sm', onclick: () => { ctx.preview = true; ctx.refresh(); } }, '👀 Student view'),
            h('button', { class: 'icon-btn', 'aria-label': 'Board settings', title: 'Board settings', onclick: () => openBoardForm(b, { onSaved: () => ctx.refresh(), onDeleted: () => { location.hash = '#/dashboard'; } }) }, '⚙️')])));
    } else {
      add(top, h('header', { class: 'topbar student-bar' },
        h('span', { class: 'logo' }, '🧸'),
        h('div', { class: 'board-title' }, h('h1', null, b.title), b.description ? h('small', null, b.description) : null),
        h('div', { class: 'topbar-actions' },
          h('span', { class: 'hello' }, `👋 Hi, ${ctx.me.display_name}!`),
          h('button', { class: 'btn btn-sm', onclick: openProgress }, '⭐ My work'),
          h('button', { class: 'link small', onclick: async () => {
            if (!(await confirmBox('Not you? This will sign you out on this device. Your posts stay on the board.', { okText: 'Sign out' }))) return;
            await sb.auth.signOut(); location.reload();
          } }, 'Not you?'))));
    }
  }

  function drawBanners() {
    clear(banners);
    const b = ctx.board;
    if (ctx.preview) add(banners, h('div', { class: 'banner info' }, '👀 You are seeing the board like a student (your teacher controls are hidden).'));
    if (b.status !== 'active') add(banners, h('div', { class: 'banner warn' }, '📦 This board is archived. Students cannot post.'));
    else if (setting(b, 'posting_locked')) add(banners, h('div', { class: 'banner warn' }, ctx.isOwner ? '🔒 Student posting is paused. Click “Posting paused” to open it again.' : '⏸️ Your teacher has paused posting. You can still look and listen.'));
    if (!ctx.isOwner && setting(b, 'require_approval')) add(banners, h('div', { class: 'banner soft' }, '⏳ Your teacher checks new posts before everyone can see them.'));
    if (ctx.connectFrom) add(banners, h('div', { class: 'banner info' }, '🔗 Click another card to connect (or remove a connection). Press Esc to cancel.'));
  }

  function drawFab() {
    clear(fab);
    if (ctx.teacherMode) return;
    if (ctx.isOwner) return; // preview: no posting as student
    if (!ctx.boardActive() || !setting(ctx.board, 'allow_posts')) return;
    if (ctx.board.layout === 'shelf') return; // shelf has per-column buttons
    add(fab, h('button', { class: 'fab', onclick: () => openComposer(ctx), 'aria-label': 'Add a post' }, '＋', h('span', null, 'Add post')));
  }

  function addMenu(anchor) {
    menu(anchor, [
      { label: '📝 Post / note', onClick: () => openComposer(ctx) },
      '-',
      { label: '🔤 Vocabulary card(s)', onClick: () => openTeacherEditor(ctx, 'vocab') },
      { label: '📖 Reading passage', onClick: () => openTeacherEditor(ctx, 'reading') },
      { label: '🐝 Spelling list', onClick: () => openTeacherEditor(ctx, 'spelling') },
      { label: '🧩 Grammar lesson', onClick: () => openTeacherEditor(ctx, 'grammar') },
      { label: '✏️ Writing prompt', onClick: () => openTeacherEditor(ctx, 'writing') },
      { label: '🗣️ Speaking prompt', onClick: () => openTeacherEditor(ctx, 'speaking') },
      '-',
      { label: '🎯 Activity, quiz or game', onClick: () => openActivityEditor(ctx) },
    ]);
  }

  // card cache keeps media playing when other cards change
  const cache = new Map();
  let structKey = '';
  function cardFor(p) {
    const sig = cardSignature(p, ctx);
    const c = cache.get(p.id);
    if (c && c.sig === sig) return c.el;
    const el = renderCard(p, ctx);
    if (ctx.board.layout === 'canvas') attachCanvasHandlers(el, p);
    if (c && c.el.isConnected) c.el.replaceWith(el);
    cache.set(p.id, { sig, el });
    return el;
  }

  function drawLayout() {
    const list = ordered(visibleTop());
    const L = ctx.board.layout;
    const key = JSON.stringify([L, ctx.teacherMode, ctx.board.sections, list.map((p) => [p.id, p.section_id, p.event_date, L === 'canvas' ? [p.pos_x, p.pos_y, p.connections] : 0]), ctx.filter]);
    if (key === structKey) { list.forEach(cardFor); if (L === 'canvas') drawLines(); return; }
    structKey = key;
    if (L !== 'canvas') [...cache.values()].forEach((c) => c.el.classList.remove('connect-from'));
    clear(area);
    if (!list.length && L !== 'shelf') {
      add(area, h('div', { class: 'empty' }, h('div', { class: 'big-emoji' }, ctx.isOwner ? '🌱' : '🎈'),
        h('p', null, ctx.teacherMode ? (ctx.filter === 'pending' ? 'Nothing is waiting for approval.' : 'This board is empty. Click “＋ Add” to add vocabulary, a reading, an activity or a post.') : 'Nothing here yet. Be the first to post!')));
      return;
    }
    const wrap = (p, extra) => h('div', { class: 'card-wrap', dataset: { id: p.id } }, extra, cardFor(p));
    if (L === 'wall') add(area, h('div', { class: 'layout-wall' }, list.map((p) => wrap(p))));
    else if (L === 'grid') add(area, h('div', { class: 'layout-grid' }, list.map((p) => wrap(p))));
    else if (L === 'stream') add(area, h('div', { class: 'layout-stream' }, list.map((p) => wrap(p))));
    else if (L === 'storyboard') add(area, h('div', { class: 'layout-story' }, list.map((p, i) => h('div', { class: 'frame' },
      h('div', { class: 'frame-num' }, `${i + 1}`), wrap(p), i < list.length - 1 ? h('div', { class: 'frame-arrow', 'aria-hidden': 'true' }, '➜') : null))));
    else if (L === 'timeline') {
      const tl = [...list].sort((a, b) => (a.event_date || a.created_at.slice(0, 10)).localeCompare(b.event_date || b.created_at.slice(0, 10)) || a.sort_order - b.sort_order);
      add(area, h('div', { class: 'layout-timeline' }, h('div', { class: 'tl-track' }, tl.map((p) => h('div', { class: 'tl-item' },
        h('div', { class: 'tl-date' }, new Date((p.event_date || p.created_at.slice(0, 10)) + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })),
        h('div', { class: 'tl-dot', 'aria-hidden': 'true' }), wrap(p))))));
    } else if (L === 'shelf') drawShelf(list, wrap);
    else if (L === 'canvas') drawCanvas(list);
  }

  function drawShelf(list, wrap) {
    const sections = ctx.board.sections?.length ? ctx.board.sections : [{ id: 's1', title: 'Column 1' }];
    const valid = new Set(sections.map((s) => s.id));
    const saveSections = async (next) => { try { await q(sb.from('boards').update({ sections: next }).eq('id', boardId)); ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); } };
    const canAdd = !ctx.teacherMode && !ctx.isOwner && ctx.boardActive() && setting(ctx.board, 'allow_posts');
    const cols = sections.map((s, si) => {
      const items = list.filter((p) => (valid.has(p.section_id) ? p.section_id : sections[0].id) === s.id);
      return h('section', { class: 'shelf-col' },
        h('div', { class: 'shelf-head' }, h('h2', null, s.title), ctx.teacherMode ? h('button', { class: 'icon-btn', 'aria-label': 'Column options', onclick: (e) => menu(e.currentTarget, [
          { label: '✏️ Rename', onClick: () => { const t = prompt('Column name', s.title); if (t && t.trim()) saveSections(sections.map((x) => x.id === s.id ? { ...x, title: t.trim().slice(0, 60) } : x)); } },
          si > 0 ? { label: '⬅️ Move left', onClick: () => { const n = [...sections]; [n[si - 1], n[si]] = [n[si], n[si - 1]]; saveSections(n); } } : null,
          si < sections.length - 1 ? { label: '➡️ Move right', onClick: () => { const n = [...sections]; [n[si + 1], n[si]] = [n[si], n[si + 1]]; saveSections(n); } } : null,
          sections.length > 1 ? { label: '🗑️ Delete column (posts move to the first column)', danger: true, onClick: async () => { if (await confirmBox(`Delete column “${s.title}”?`, { danger: true, okText: 'Delete' })) saveSections(sections.filter((x) => x.id !== s.id)); } } : null,
        ]) }, '⋯') : null),
        h('div', { class: 'shelf-items' }, items.map((p) => wrap(p))),
        ctx.teacherMode ? h('button', { class: 'btn btn-soft btn-block', onclick: () => openComposer(ctx, { sectionId: s.id }) }, '＋ Add post here') : null,
        canAdd ? h('button', { class: 'btn btn-task btn-block', onclick: () => openComposer(ctx, { sectionId: s.id }) }, '＋ Add my post') : null);
    });
    if (ctx.teacherMode) cols.push(h('button', { class: 'shelf-add-col', onclick: () => {
      const t = prompt('New column name', `Column ${sections.length + 1}`); if (t && t.trim()) saveSections([...sections, { id: 's' + Date.now().toString(36), title: t.trim().slice(0, 60) }]);
    } }, '＋ Add column'));
    add(area, h('div', { class: 'layout-shelf' }, cols));
  }

  // ---------- canvas ----------
  let canvasEl = null, svg = null, zTop = 10;
  function drawCanvas(list) {
    let maxX = 1200, maxY = 800;
    list.forEach((p, i) => {
      if (p.pos_x === null || p.pos_x === undefined) { p.pos_x = 40 + (i % 5) * 290; p.pos_y = 40 + Math.floor(i / 5) * 280; }
      maxX = Math.max(maxX, p.pos_x + 400); maxY = Math.max(maxY, p.pos_y + 500);
    });
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'canvas-lines'); svg.setAttribute('width', maxX); svg.setAttribute('height', maxY);
    canvasEl = h('div', { class: 'layout-canvas', style: { width: `${maxX}px`, height: `${maxY}px` } }, svg,
      list.map((p) => h('div', { class: 'card-wrap canvas-item', dataset: { id: p.id }, style: { left: `${p.pos_x}px`, top: `${p.pos_y}px` } }, cardFor(p))));
    add(area, h('div', { class: 'canvas-scroll' }, canvasEl), ctx.teacherMode ? h('p', { class: 'hint canvas-hint' }, 'Drag cards by their top bar. Use ⋯ → “Connect to…” to link ideas.') : null);
    requestAnimationFrame(drawLines);
  }
  function drawLines() {
    if (!svg || !canvasEl || !canvasEl.isConnected) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const pos = {};
    canvasEl.querySelectorAll('.canvas-item').forEach((w) => { pos[w.dataset.id] = { x: w.offsetLeft + w.offsetWidth / 2, y: w.offsetTop + Math.min(w.offsetHeight / 2, 120) }; });
    ctx.posts.forEach((p) => (p.connections || []).forEach((t) => {
      const a = pos[p.id], b = pos[t]; if (!a || !b) return;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const mx = (a.x + b.x) / 2;
      line.setAttribute('d', `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`);
      line.setAttribute('class', 'conn');
      svg.appendChild(line);
    }));
  }
  function attachCanvasHandlers(card, p) {
    card.addEventListener('click', (e) => { if (ctx.connectFrom && ctx.connectFrom !== p.id) { e.stopPropagation(); e.preventDefault(); finishConnect(p); } }, true);
    const head = card.querySelector('.card-head');
    const canDrag = ctx.teacherMode || (p.author_id === ctx.uid && !ctx.isOwner && setting(ctx.board, 'allow_edit_own') && ctx.boardActive());
    if (!canDrag || !head) return;
    head.classList.add('drag-handle');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button,a,input')) return;
      const w = card.parentElement; if (!w || !w.classList.contains('canvas-item')) return;
      e.preventDefault(); head.setPointerCapture(e.pointerId);
      w.style.zIndex = String(++zTop);
      const sx = e.clientX, sy = e.clientY, ox = w.offsetLeft, oy = w.offsetTop;
      let moved = false;
      const mv = (ev) => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        w.style.left = `${Math.max(0, ox + dx)}px`; w.style.top = `${Math.max(0, oy + dy)}px`; drawLines(); };
      const up = async () => {
        head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
        if (!moved) return;
        p.pos_x = Math.round(w.offsetLeft); p.pos_y = Math.round(w.offsetTop);
        try { await q(sb.from('posts').update({ pos_x: p.pos_x, pos_y: p.pos_y }).eq('id', p.id)); } catch (er) { toast(errMsg(er), 'error'); ctx.refresh(); }
      };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
  }

  // ---------- spotlight (teacher shows one post on every screen) ----------
  let spotState = { id: null, sig: null, dismissed: null };
  function drawSpotlight() {
    const id = ctx.board.spotlight_post_id;
    const p = id && ctx.posts.find((x) => x.id === id);
    if (!p || spotState.dismissed === id) { clear(spot); spotState.id = null; return; }
    const sig = cardSignature(p, ctx);
    if (spotState.id === id && spotState.sig === sig) return;
    spotState = { ...spotState, id, sig };
    add(clear(spot), h('div', { class: 'spotlight' }, h('div', { class: 'spot-inner' },
      h('div', { class: 'row space spot-head' }, h('strong', null, '🖥️ Your teacher is showing:'),
        ctx.isOwner ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => ctx.spotlight(null) }, 'Stop showing to the class')
          : h('button', { class: 'btn btn-sm', onclick: () => { spotState.dismissed = id; clear(spot); } }, 'Close')),
      renderCard(p, ctx, { detail: true }))));
  }

  // ---------- student progress ----------
  async function openProgress() {
    const body = h('div', { class: 'stack' }, h('p', null, 'Loading…'));
    modal({ title: '⭐ My work and progress', size: 'large', body });
    let rows = [];
    try { rows = await q(sb.rpc('board_progress', { p_board: boardId })); } catch (e) { toast(errMsg(e), 'error'); }
    const me = rows.find((r) => r.user_id === ctx.uid) || { posts: 0, responses: 0, activities: 0, score: 0, total: 0, audio: 0 };
    const points = (r) => r.posts + r.responses + r.activities + Number(r.score || 0);
    const myAssess = ctx.assessments;
    const badges = [
      [me.posts >= 1, '📝', 'First post'], [me.audio >= 1, '🎤', 'Voice star'], [me.responses + me.activities >= 3, '🚀', 'Busy learner'],
      [myAssess.some((a) => a.auto_total && Number(a.auto_score) === Number(a.auto_total)), '🏆', 'Perfect score'],
      [ctx.comments.filter((c) => c.author_id === ctx.uid).length >= 3, '🤝', 'Kind helper'],
      [myAssess.some((a) => a.feedback || a.mark), '💌', 'Got feedback'],
    ];
    const mine = ctx.posts.filter((p) => p.author_id === ctx.uid).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const tasks = ctx.posts.filter((p) => !p.parent_id && TASK_KINDS.includes(p.kind) && p.is_open && !ctx.myResponse(p.id));
    add(clear(body), 
      h('div', { class: 'stat-tiles' },
        h('div', { class: 'tile' }, h('strong', null, String(points(me))), h('span', null, '⭐ points')),
        h('div', { class: 'tile' }, h('strong', null, String(me.posts)), h('span', null, '📝 posts')),
        h('div', { class: 'tile' }, h('strong', null, String(me.responses + me.activities)), h('span', null, '✅ tasks done')),
        h('div', { class: 'tile' }, h('strong', null, String(me.audio)), h('span', null, '🎤 recordings'))),
      h('h3', null, '🏅 My badges'),
      h('div', { class: 'badges' }, badges.map(([on, icon, label]) => h('div', { class: `badge ${on ? 'on' : ''}` }, h('span', null, icon), h('small', null, label)))),
      tasks.length ? [h('h3', null, '📌 Still to do'), h('ul', { class: 'todo' }, tasks.map((t) => h('li', null, `${KIND_INFO[t.kind].icon} ${t.title || KIND_INFO[t.kind].label}`)))] : null,
      h('h3', null, '📂 My posts and answers'),
      mine.length ? h('div', { class: 'my-work' }, mine.map((p) => {
        const a = ctx.assessmentFor(p.id);
        const parent = p.parent_id && ctx.posts.find((x) => x.id === p.parent_id);
        return h('button', { class: 'my-work-item', onclick: () => openPost(ctx, p) },
          h('span', null, p.kind === 'response' ? `📥 ${parent?.title || 'Answer'}` : `📝 ${p.title || p.body.slice(0, 40) || 'Post'}`),
          h('span', { class: 'row' },
            p.status === 'pending' ? h('span', { class: 'status-chip st-pending' }, '⏳ Waiting') : p.status === 'rejected' ? h('span', { class: 'status-chip st-rejected' }, '🚫 Not approved') : null,
            a?.auto_total ? h('span', { class: 'chip' }, `🎯 ${a.auto_score}/${a.auto_total}`) : null,
            a?.mark ? h('span', { class: 'chip' }, `📝 ${a.mark}`) : null,
            a?.feedback ? h('span', { class: 'chip' }, '💬 Feedback') : null));
      })) : h('p', { class: 'muted' }, 'You have not posted yet.'),
      rows.length > 1 ? [h('h3', null, '🏆 Class leaderboard'), h('ol', { class: 'leaderboard' },
        [...rows].sort((a, b) => points(b) - points(a)).slice(0, 20).map((r) => h('li', { class: r.user_id === ctx.uid ? 'me' : '' }, h('span', null, r.display_name), h('strong', null, `${points(r)} ⭐`))))] : null);
  }

  // ---------- live updates ----------
  const channel = sb.channel(`board-${boardId}-${Math.random().toString(36).slice(2, 8)}`);
  ['posts', 'comments', 'reactions', 'assessments', 'board_members'].forEach((t) =>
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `board_id=eq.${boardId}` }, soon));
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'boards', filter: `id=eq.${boardId}` }, soon);
  channel.subscribe();
  const poll = setInterval(() => { if (document.visibilityState === 'visible') ctx.refresh(); }, 20000);
  const onVis = () => { if (document.visibilityState === 'visible') ctx.refresh(); };
  document.addEventListener('visibilitychange', onVis);
  const onResize = debounce(() => { if (ctx.board.layout === 'canvas') drawLines(); }, 200);
  window.addEventListener('resize', onResize);
  let stopped = false;
  function stop() {
    if (stopped) return; stopped = true;
    try { sb.removeChannel(channel); } catch { /* */ }
    clearInterval(poll); document.removeEventListener('visibilitychange', onVis); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize);
  }

  render();
  document.title = `${ctx.board.title} · ${APP_NAME}`;
  return stop;
}
