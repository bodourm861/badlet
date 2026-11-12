// One post card, its menu, reactions, and the post detail dialog with comments.
import { sb, q } from '../supa.js';
import { h, add, clear, modal, toast, errMsg, menu, confirmBox, timeAgo, safeUrl, youTubeId, vimeoId, KIND_INFO, TASK_KINDS, busy, deferWhileEditing } from '../ui.js';
import { renderAttachment, removeFiles, fileCat } from '../files.js';
import { speak, speakButton } from '../media.js';
import { setting } from './boardForm.js';
import { openComposer, openTeacherEditor, openResponse, openSpellingPractice } from './composer.js';
import { openActivityEditor, openActivityPlayer, ACTIVITY_TEMPLATES } from './activities.js';
import { openResponses, openSharedAnswers } from './review.js';

export function displayName(p, ctx) {
  if (p.is_teacher || p.author_id === ctx.uid || ctx.teacherMode || setting(ctx.board, 'show_names')) return p.author_name || 'Someone';
  return 'Classmate';
}

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

export function cardSignature(p, ctx) {
  const r = ctx.reactSummary(p.id);
  const resp = ctx.responsesFor(p.id);
  const mine = ctx.myResponse(p.id);
  const a = mine ? ctx.assessmentFor(mine.id) : null;
  return JSON.stringify([p.updated_at, p.status, p.is_open, p.pinned, r, ctx.commentsFor(p.id).length, resp.length,
    resp.filter((x) => x.status === 'pending').length, mine?.updated_at, a?.updated_at, ctx.settingsKey, ctx.teacherMode, ctx.connectFrom === p.id]);
}

export function renderCard(p, ctx, { detail = false } = {}) {
  const mine = p.author_id === ctx.uid;
  const teacher = ctx.teacherMode;
  const name = displayName(p, ctx);
  const color = p.kind === 'note' ? `note-${p.data?.color || (p.is_teacher ? 'white' : 'yellow')}` : `kind-${p.kind}`;
  const info = KIND_INFO[p.kind] || KIND_INFO.note;
  const atts = p.attachments || [];

  const head = h('div', { class: 'card-head' },
    h('span', { class: `avatar ${p.is_teacher ? 'avatar-teacher' : ''}`, 'aria-hidden': 'true' }, p.is_teacher ? '🍎' : initial(name)),
    h('div', { class: 'card-who' }, h('strong', null, name), h('small', null, timeAgo(p.created_at))),
    p.kind !== 'note' ? h('span', { class: 'kind-badge' }, `${info.icon} ${info.label}`) : null,
    p.pinned ? h('span', { class: 'pin', title: 'Pinned' }, '📌') : null,
    cardMenuButton(p, ctx));
  const statusLine = (teacher || mine) && p.status !== 'approved'
    ? h('div', { class: `status-chip st-${p.status}` }, p.status === 'pending' ? (teacher ? '⏳ Waiting for your approval' : '⏳ Waiting for teacher') : '🚫 Not approved') : null;

  const body = h('div', { class: 'card-body' });
  if (statusLine) add(body, statusLine);
  if (p.title) add(body, h('h3', { class: 'card-title' }, p.title));
  add(body, kindBlock(p, ctx));
  if (p.body && p.kind !== 'reading') add(body, h('p', { class: 'card-text' }, p.body));
  const link = safeUrl(p.link_url);
  if (link) add(body, h('a', { class: 'link-chip', href: link, target: '_blank', rel: 'noopener noreferrer' }, '🔗 ', new URL(link).hostname.replace(/^www\./, '')));
  const vid = videoEmbed(p.video_url);
  if (vid) add(body, vid);
  const shownAtts = p.kind === 'activity' ? [] : atts;
  if (shownAtts.length) add(body, h('div', { class: 'attachments' }, shownAtts.map((a) => renderAttachment(a))));
  if (TASK_KINDS.includes(p.kind)) add(body, taskBar(p, ctx));

  const card = h('article', { class: `post-card ${color} ${p.status !== 'approved' ? 'is-' + p.status : ''} ${detail ? 'detail' : ''}`, dataset: { id: p.id } },
    head, body, detail ? null : footer(p, ctx));
  if (ctx.connectFrom === p.id) card.classList.add('connect-from');
  return card;
}

function kindBlock(p, ctx) {
  const d = p.data || {};
  if (p.kind === 'vocab') {
    return h('div', { class: 'vocab' },
      h('div', { class: 'vocab-word' }, h('span', null, d.word || p.title || ''), d.word ? speakButton(d.word, '🔊', 'Listen to the word') : null),
      d.definition ? h('p', null, h('strong', null, 'Meaning: '), d.definition) : null,
      d.example ? h('p', { class: 'vocab-ex' }, h('strong', null, 'Example: '), d.example, ' ', speakButton(d.example, '🔊', 'Listen to the sentence')) : null);
  }
  if (p.kind === 'reading') {
    return h('div', { class: 'reading' },
      p.body ? h('div', { class: 'passage' }, p.body) : null,
      p.body ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => speak(p.body, { rate: 0.8 }) }, '🔊 Read it to me') : null,
      (d.questions || []).length ? h('div', { class: 'questions' }, h('strong', null, '❓ Questions'),
        h('ol', null, d.questions.map((qq) => h('li', null, qq)))) : null);
  }
  if (p.kind === 'spelling') {
    return h('div', { class: 'spelling' },
      h('div', { class: 'word-chips' }, (d.words || []).map((w) => h('span', { class: 'word-chip' }, w, speakButton(w, '🔊', 'Listen')))),
      (d.words || []).length ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openSpellingPractice(d.words) }, '✏️ Practise spelling') : null);
  }
  if (p.kind === 'grammar') {
    return (d.examples || []).length ? h('div', { class: 'grammar' }, h('strong', null, '💡 Examples'),
      h('ul', null, d.examples.map((ex) => h('li', null, ex, ' ', speakButton(ex, '🔊', 'Listen'))))) : h('span');
  }
  if (p.kind === 'activity') {
    const t = ACTIVITY_TEMPLATES[d.template] || ACTIVITY_TEMPLATES.quiz;
    return h('div', { class: 'activity-info' }, h('span', { class: 'big-emoji-sm' }, t.icon), h('span', null, `${t.label} · ${(d.questions || []).length} questions`));
  }
  return h('span');
}

function videoEmbed(u) {
  const url = safeUrl(u);
  if (!url) return null;
  const yt = youTubeId(url);
  if (yt) return h('div', { class: 'video-wrap' }, h('iframe', { src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}`, title: 'Video', allowfullscreen: true, loading: 'lazy',
    allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin' }));
  const vm = vimeoId(url);
  if (vm) return h('div', { class: 'video-wrap' }, h('iframe', { src: `https://player.vimeo.com/video/${vm}`, title: 'Video', allowfullscreen: true, loading: 'lazy' }));
  return h('a', { class: 'link-chip', href: url, target: '_blank', rel: 'noopener noreferrer' }, '🎬 Watch video');
}

const TASK_VERB = { vocab: '🎤 Say the word', reading: '🎤 Read aloud & answer', spelling: '🎤 Record my spelling', grammar: '✏️ Try it',
  writing: '✏️ Write my answer', speaking: '🎤 Record my answer', activity: '▶️ Start' };

function taskBar(p, ctx) {
  const bar = h('div', { class: 'task-bar' });
  if (ctx.teacherMode) {
    const resp = ctx.responsesFor(p.id);
    const waiting = resp.filter((r) => r.status === 'pending').length;
    add(bar, 
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => openResponses(ctx, p) }, `📥 ${resp.length} answer${resp.length === 1 ? '' : 's'}${waiting ? ` (${waiting} waiting)` : ''}`),
      p.kind === 'activity' ? h('button', { class: 'btn btn-sm', onclick: () => openActivityPlayer(ctx, p, { preview: true }) }, '👀 Preview') : null,
      h('button', { class: `btn btn-sm ${p.is_open ? 'btn-open' : 'btn-closed'}`, title: 'Open or close answers', onclick: async () => {
        try { await q(sb.from('posts').update({ is_open: !p.is_open }).eq('id', p.id)); ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); }
      } }, p.is_open ? '🟢 Open' : '🔴 Closed'));
    return bar;
  }
  const mine = ctx.myResponse(p.id);
  const canAct = p.is_open && ctx.canPostAnything();
  if (mine) {
    const a = ctx.assessmentFor(mine.id);
    add(bar, h('span', { class: 'done-badge' }, mine.status === 'pending' ? '⏳ Sent' : '✅ Done'));
    if (a && (a.mark || a.feedback)) add(bar, h('span', { class: 'fb-badge' }, '💬 Feedback'));
    add(bar, h('button', { class: 'btn btn-sm', onclick: () => openPost(ctx, mine) }, 'See my answer'));
    if (canAct && p.kind === 'activity' && p.data?.allow_retry !== false) add(bar, h('button', { class: 'btn btn-sm', onclick: () => openActivityPlayer(ctx, p) }, '🔁 Try again'));
    if (canAct && p.kind !== 'activity' && setting(ctx.board, 'allow_edit_own')) add(bar, h('button', { class: 'btn btn-sm', onclick: () => openResponse(ctx, p, mine) }, '✏️ Change'));
  } else if (canAct) {
    add(bar, h('button', { class: 'btn btn-task', onclick: () => p.kind === 'activity' ? openActivityPlayer(ctx, p) : openResponse(ctx, p) }, TASK_VERB[p.kind] || 'Answer'));
  } else if (!p.is_open) {
    add(bar, h('span', { class: 'muted small' }, '🔒 Closed'));
  }
  if (p.data?.share_responses && p.kind !== 'activity') {
    const n = ctx.responsesFor(p.id).filter((r) => r.visibility === 'board' && r.status === 'approved').length;
    if (n) add(bar, h('button', { class: 'btn btn-sm', onclick: () => openSharedAnswers(ctx, p) }, `👀 Class answers (${n})`));
  }
  return bar;
}

function footer(p, ctx) {
  const r = ctx.reactSummary(p.id);
  const shown = { allow_likes: r.likes, allow_votes: r.votes, allow_stars: r.starCount };
  const s = (k) => setting(ctx.board, k) || (ctx.teacherMode && shown[k] > 0);
  const can = (k) => ctx.isOwner || (setting(ctx.board, k) && ctx.boardActive());
  const items = [];
  if (s('allow_likes')) items.push(h('button', { class: `react ${r.myLike ? 'on' : ''}`, disabled: !can('allow_likes'), 'aria-label': 'Like', onclick: () => react(ctx, p, 'like', 1, r.myLike) }, r.myLike ? '❤️' : '🤍', ` ${r.likes || ''}`));
  if (s('allow_votes')) items.push(h('button', { class: `react ${r.myVote ? 'on' : ''}`, disabled: !can('allow_votes'), 'aria-label': 'Vote', onclick: () => react(ctx, p, 'vote', 1, r.myVote) }, '👍', ` ${r.votes || ''}`));
  if (s('allow_stars')) {
    items.push(h('span', { class: 'stars', 'aria-label': 'Star rating' },
      [1, 2, 3, 4, 5].map((n) => h('button', { class: `star ${n <= (r.myStar || 0) ? 'on' : ''}`, disabled: !can('allow_stars'), 'aria-label': `${n} stars`,
        onclick: () => react(ctx, p, 'star', n, r.myStar === n) }, n <= (r.myStar || Math.round(r.starAvg || 0)) ? '★' : '☆')),
      r.starCount ? h('small', null, ` ${r.starAvg.toFixed(1)} (${r.starCount})`) : null));
  }
  const nComments = ctx.commentsFor(p.id).length;
  if (setting(ctx.board, 'allow_comments') || setting(ctx.board, 'allow_peer_feedback') || nComments || ctx.teacherMode) items.push(h('button', { class: 'react', 'aria-label': 'Comments', onclick: () => openPost(ctx, p) }, '💬', ` ${nComments || ''}`));
  items.push(h('button', { class: 'react expand', 'aria-label': 'Open', title: 'Open', onclick: () => openPost(ctx, p) }, '⤢'));
  return h('div', { class: 'card-foot' }, items);
}

async function react(ctx, p, kind, value, remove) {
  try {
    if (remove) await q(sb.from('reactions').delete().eq('post_id', p.id).eq('user_id', ctx.uid).eq('kind', kind));
    else await q(sb.from('reactions').upsert({ post_id: p.id, user_id: ctx.uid, board_id: p.board_id, kind, value }, { onConflict: 'post_id,user_id,kind' }));
    ctx.refresh();
  } catch (e) { toast(errMsg(e), 'error'); }
}

function cardMenuButton(p, ctx) {
  const mine = p.author_id === ctx.uid;
  const teacher = ctx.teacherMode;
  const studentCanEdit = mine && !ctx.isOwner && setting(ctx.board, 'allow_edit_own') && ctx.canPostAnything() && p.kind === 'note';
  if (!teacher && !studentCanEdit) return null;
  return h('button', { class: 'icon-btn card-menu', 'aria-label': 'Post options', onclick: (e) => {
    e.stopPropagation();
    const items = [];
    if (teacher) {
      items.push({ label: '✏️ Edit', onClick: () => editPost(ctx, p) });
      if (p.status !== 'approved') items.push({ label: '✅ Approve', onClick: () => setStatus(ctx, p, 'approved') });
      if (p.status !== 'rejected' && !p.is_teacher) items.push({ label: '🚫 Reject (hide)', onClick: () => setStatus(ctx, p, 'rejected') });
      items.push({ label: p.pinned ? '📌 Unpin' : '📌 Pin to top', onClick: () => update(ctx, p, { pinned: !p.pinned }) });
      items.push({ label: '🖥️ Show to the class', onClick: () => ctx.spotlight(p.id) });
      items.push({ label: '⬆️ Move earlier', onClick: () => ctx.move(p, -1) }, { label: '⬇️ Move later', onClick: () => ctx.move(p, 1) });
      if (ctx.board.layout === 'shelf') items.push({ label: '🗂️ Move to column…', onClick: () => ctx.moveToSection(p) });
      if (ctx.board.layout === 'canvas') items.push({ label: '🔗 Connect to…', onClick: () => ctx.startConnect(p) });
      items.push('-', { label: '🗑️ Delete', danger: true, onClick: () => deletePost(ctx, p) });
    } else {
      items.push({ label: '✏️ Edit my post', onClick: () => openComposer(ctx, { post: p }) });
      items.push({ label: '🗑️ Delete my post', danger: true, onClick: () => deletePost(ctx, p) });
    }
    menu(e.currentTarget, items);
  } }, '⋯');
}

export function editPost(ctx, p) {
  if (p.kind === 'note') return openComposer(ctx, { post: p });
  if (p.kind === 'activity') return openActivityEditor(ctx, p);
  return openTeacherEditor(ctx, p.kind, p);
}

async function update(ctx, p, patch) {
  try { await q(sb.from('posts').update(patch).eq('id', p.id)); ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); }
}
export async function setStatus(ctx, p, status) { await update(ctx, p, { status }); toast(status === 'approved' ? 'Approved ✅' : 'Hidden from the class', 'ok'); }

export async function deletePost(ctx, p) {
  const kids = ctx.isOwner ? ctx.posts.filter((x) => x.parent_id === p.id) : [];
  const msg = kids.length ? `Delete this and the ${kids.length} student answers to it?` : 'Delete this post?';
  if (!(await confirmBox(msg, { okText: 'Delete', danger: true }))) return;
  try {
    await q(sb.from('posts').delete().eq('id', p.id));
    const paths = [p, ...kids].flatMap((x) => (x.attachments || []).map((a) => a.path)).filter((x) => x.startsWith('b/'));
    await removeFiles(paths);
    toast('Deleted', 'ok');
    ctx.refresh();
  } catch (e) { toast(errMsg(e), 'error'); }
}

// Big view of one post with comments and peer feedback.
export function openPost(ctx, p) {
  const wrap = h('div', { class: 'post-detail' });
  const m = modal({ title: p.kind === 'response' ? 'Answer' : (p.title || KIND_INFO[p.kind]?.label || 'Post'), size: 'large', body: wrap });
  const draw = () => {
    const fresh = ctx.posts.find((x) => x.id === p.id) || p;
    clear(wrap);
    if (fresh.kind === 'response') add(wrap, responseView(ctx, fresh));
    else add(wrap, renderCard(fresh, ctx, { detail: true }), footer(fresh, ctx));
    add(wrap, commentsBlock(ctx, fresh, draw));
  };
  draw();
  const off = ctx.onChange(deferWhileEditing(wrap, draw));
  const origClose = m.close; m.close = () => { off(); origClose(); };
  return m;
}

export function responseView(ctx, r) {
  const parent = ctx.posts.find((x) => x.id === r.parent_id);
  const a = ctx.assessmentFor(r.id);
  const answers = r.data?.answers || [];
  const qs = parent?.kind === 'activity' ? (parent.data?.questions || []) : (parent?.data?.questions || []);
  return h('div', { class: 'response-view' },
    parent ? h('p', { class: 'muted' }, `${KIND_INFO[parent.kind]?.icon || ''} Task: `, h('strong', null, parent.title || KIND_INFO[parent.kind]?.label)) : null,
    h('p', null, h('strong', null, displayName(r, ctx)), h('span', { class: 'muted' }, ` · ${timeAgo(r.created_at)}`),
      r.status !== 'approved' ? h('span', { class: `status-chip st-${r.status}` }, r.status === 'pending' ? '⏳ Waiting' : '🚫 Not approved') : null),
    r.body ? h('div', { class: 'answer-text' }, r.body) : null,
    answers.length ? h('ol', { class: 'answer-list' }, answers.map((ans, i) => h('li', null,
      qs[i] ? h('div', { class: 'muted small' }, typeof qs[i] === 'string' ? qs[i] : (qs[i].prompt || '')) : null,
      h('div', null, formatAnswer(qs[i], ans))))) : null,
    (r.attachments || []).length ? h('div', { class: 'attachments' }, r.attachments.map((x) => renderAttachment(x))) : null,
    a ? h('div', { class: 'feedback-box' },
      a.auto_total ? h('p', null, `🎯 Score: ${a.auto_score} / ${a.auto_total}`) : null,
      a.mark ? h('p', null, h('strong', null, '📝 Mark: '), a.mark) : null,
      a.feedback ? h('p', null, h('strong', null, '💬 Teacher feedback: '), a.feedback) : null) : null);
}

export function formatAnswer(question, ans) {
  if (ans === null || ans === undefined || ans === '') return '—';
  if (question && typeof question === 'object') {
    if (question.type === 'mcq' && Array.isArray(question.choices)) return question.choices[ans] ?? String(ans);
    if (question.type === 'tf') return ans === true ? 'True' : ans === false ? 'False' : String(ans);
  }
  return String(ans);
}

function commentsBlock(ctx, p, redraw) {
  const list = ctx.commentsFor(p.id);
  const allowC = ctx.isOwner || (setting(ctx.board, 'allow_comments') && ctx.canPostAnything());
  const allowP = !ctx.isOwner && setting(ctx.board, 'allow_peer_feedback') && ctx.canPostAnything() && p.author_id !== ctx.uid && !p.is_teacher;
  const box = h('section', { class: 'comments' }, h('h3', null, `💬 Comments${list.length ? ` (${list.length})` : ''}`));
  if (!list.length) add(box, h('p', { class: 'muted' }, 'No comments yet.'));
  list.forEach((c) => {
    const canDel = ctx.isOwner || c.author_id === ctx.uid;
    add(box, h('div', { class: `comment ${c.is_teacher ? 'from-teacher' : ''} ${c.kind === 'peer' ? 'peer' : ''}` },
      h('div', { class: 'row space' },
        h('strong', null, c.is_teacher ? `🍎 ${c.author_name}` : (ctx.teacherMode || c.author_id === ctx.uid || setting(ctx.board, 'show_names') ? c.author_name : 'Classmate'),
          c.kind === 'peer' ? h('span', { class: 'chip chip-sm' }, 'Peer feedback') : null),
        h('span', { class: 'muted small' }, timeAgo(c.created_at),
          canDel ? h('button', { class: 'link small', onclick: async () => {
            if (!(await confirmBox('Delete this comment?', { okText: 'Delete', danger: true }))) return;
            try { await q(sb.from('comments').delete().eq('id', c.id)); ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); }
          } }, ' Delete') : null)),
      h('p', null, c.body)));
  });
  const addForm = (kind, placeholder, starters) => {
    const ta = h('textarea', { class: 'input', rows: 2, maxlength: 1000, placeholder });
    const send = h('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
      if (!ta.value.trim()) return;
      busy(send, true, 'Sending…');
      try {
        await q(sb.from('comments').insert({ post_id: p.id, board_id: p.board_id, kind, body: ta.value.trim(), author_name: ctx.myName() }));
        ta.value = ''; await ctx.refresh(); redraw();
      } catch (e) { toast(errMsg(e), 'error'); } finally { busy(send, false); }
    } }, kind === 'peer' ? 'Send feedback' : 'Send');
    return h('div', { class: 'comment-form' },
      starters ? h('div', { class: 'starters' }, starters.map((s) => h('button', { type: 'button', class: 'chip-btn', onclick: () => { ta.value = (ta.value ? ta.value + ' ' : '') + s; ta.focus(); } }, s))) : null,
      ta, send);
  };
  if (allowC) add(box, addForm('comment', ctx.isOwner ? 'Write a comment the class can see…' : 'Write a kind comment…'));
  if (allowP) add(box, h('h4', null, '🌟 Peer feedback'), addForm('peer', 'Two stars and a wish…', ['⭐ I like…', '⭐ Great use of…', '🌱 Next time you could…']));
  if (!allowC && !allowP && !ctx.isOwner) add(box, h('p', { class: 'muted small' }, 'Comments are turned off.'));
  return box;
}
