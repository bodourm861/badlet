// Teacher monitoring: participation, who has not submitted, review & marks, roster, CSV export.
import { sb, q, currentUser, isTeacherUser } from '../supa.js';
import { h, add, clear, modal, toast, errMsg, busy, fmtDateTime, normName, toCSV, downloadFile, confirmBox, KIND_INFO, TASK_KINDS, debounce, deferWhileEditing } from '../ui.js';
import { teacherTopbar } from './dashboard.js';
import { openResponses, reviewItem, expectedStudents } from './review.js';
import { renderAttachment } from '../files.js';
import { formatAnswer } from './postcard.js';

export async function renderMonitor(app, boardId) {
  const user = await currentUser();
  if (!isTeacherUser(user)) { location.hash = '#/teacher'; return; }
  const boards = await q(sb.from('boards').select('*').eq('id', boardId).eq('owner_id', user.id));
  if (!boards.length) { add(app, h('div', { class: 'center-card' }, h('h1', null, 'Board not found'), h('a', { class: 'btn', href: '#/dashboard' }, 'Back'))); return; }
  const board = boards[0];
  const m = { board, posts: [], members: [], assessments: [], keys: {}, roster: [], comments: [], teacherMode: true, isOwner: true, uid: user.id };
  const listeners = new Set();
  m.onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  m.assessmentFor = (id) => m.assessments.find((a) => a.post_id === id) || null;
  m.responsesFor = (id) => m.posts.filter((p) => p.parent_id === id);
  let redraw = () => draw();
  m.refresh = async () => { await load(); redraw(); listeners.forEach((f) => f()); };

  async function load() {
    const [posts, members, assessments, keys, secrets, comments] = await Promise.all([
      q(sb.from('posts').select('*').eq('board_id', boardId).order('sort_order').limit(5000)),
      q(sb.from('board_members').select('*').eq('board_id', boardId).order('display_name')),
      q(sb.from('assessments').select('*').eq('board_id', boardId).limit(5000)),
      q(sb.from('activity_keys').select('post_id,answers').eq('board_id', boardId)),
      q(sb.from('board_secrets').select('roster').eq('board_id', boardId)),
      q(sb.from('comments').select('author_id').eq('board_id', boardId).limit(10000)),
    ]);
    Object.assign(m, { posts, members, assessments, comments, keys: Object.fromEntries(keys.map((k) => [k.post_id, k.answers])), roster: secrets[0]?.roster || [] });
  }

  const content = h('main', { class: 'page monitor' });
  add(app, teacherTopbar(user, [h('a', { class: 'btn btn-sm', href: `#/t/${boardId}` }, '← Back to board')]), content);
  let tab = 'tasks';

  const tasks = () => m.posts.filter((p) => !p.parent_id && p.is_teacher && TASK_KINDS.includes(p.kind));
  const people = () => expectedStudents(m);
  const byStudent = (s) => m.posts.filter((p) => s.ids.includes(p.author_id) && !p.is_teacher);
  const responseOf = (s, task) => m.posts.find((p) => p.parent_id === task.id && s.ids.includes(p.author_id));

  function draw() {
    const students = people();
    const joined = m.members.length;
    const responses = m.posts.filter((p) => p.kind === 'response');
    const audio = m.posts.filter((p) => !p.is_teacher && (p.attachments || []).some((a) => (a.type || '').startsWith('audio'))).length;
    add(clear(content), 
      h('div', { class: 'page-head' },
        h('div', null, h('h1', null, `📊 ${board.title}`), h('p', { class: 'muted' }, 'Live view of your class. Updates by itself.')),
        h('button', { class: 'btn', onclick: (e) => { busy(e.currentTarget, true); m.refresh().finally(() => busy(e.currentTarget, false)); } }, '🔄 Refresh')),
      h('div', { class: 'stat-tiles' },
        tile(joined, '🙋 students joined'),
        tile(m.posts.filter((p) => p.kind === 'note' && !p.is_teacher).length, '📝 student posts'),
        tile(responses.length, '📥 answers to tasks'),
        tile(m.posts.filter((p) => p.status === 'pending').length, '⏳ waiting for approval'),
        tile(audio, '🎤 recordings')),
      h('div', { class: 'tabs', role: 'tablist' }, [['tasks', '📋 Tasks'], ['students', '🧑‍🎓 Students'], ['roster', '📝 Class list'], ['export', '⬇️ Export']].map(([k, label]) =>
        h('button', { role: 'tab', class: `tab ${tab === k ? 'on' : ''}`, 'aria-selected': tab === k ? 'true' : 'false', onclick: () => { tab = k; draw(); } }, label))),
      tab === 'tasks' ? tasksTab(students) : tab === 'students' ? studentsTab(students) : tab === 'roster' ? rosterTab(students) : exportTab(students));
  }
  const tile = (n, label) => h('div', { class: 'tile' }, h('strong', null, String(n)), h('span', null, label));

  function tasksTab(students) {
    const list = tasks();
    if (!list.length) return h('p', { class: 'empty' }, 'No tasks yet. On the board click “＋ Add” → a vocabulary card, reading, writing/speaking prompt or an activity.');
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Task', 'Answered', 'Not yet', 'Waiting', 'Average score', 'Status', ''].map((t) => h('th', null, t)))),
      h('tbody', null, list.map((t) => {
        const resp = m.responsesFor(t.id);
        const missing = students.filter((s) => !responseOf(s, t));
        const scored = resp.map((r) => m.assessmentFor(r.id)).filter((a) => a && a.auto_total);
        const avg = scored.length ? Math.round(100 * scored.reduce((s, a) => s + a.auto_score / a.auto_total, 0) / scored.length) + '%' : '—';
        const pct = students.length ? Math.round(100 * (students.length - missing.length) / students.length) : 0;
        return h('tr', null,
          h('td', null, h('strong', null, `${KIND_INFO[t.kind].icon} ${t.title || KIND_INFO[t.kind].label}`)),
          h('td', null, h('div', { class: 'bar' }, h('span', { style: { width: `${pct}%` } })), h('small', null, `${students.length - missing.length} / ${students.length}`)),
          h('td', null, missing.length ? h('details', null, h('summary', null, `${missing.length} student${missing.length === 1 ? '' : 's'}`), h('small', null, missing.map((s) => s.name).join(', '))) : '🎉 none'),
          h('td', null, String(resp.filter((r) => r.status === 'pending').length)),
          h('td', null, avg),
          h('td', null, h('button', { class: `btn btn-sm ${t.is_open ? 'btn-open' : 'btn-closed'}`, onclick: async () => {
            try { await q(sb.from('posts').update({ is_open: !t.is_open }).eq('id', t.id)); m.refresh(); } catch (e) { toast(errMsg(e), 'error'); }
          } }, t.is_open ? '🟢 Open' : '🔴 Closed')),
          h('td', null, h('button', { class: 'btn btn-sm btn-primary', onclick: () => openResponses(m, t) }, 'Review & mark')));
      }))));
  }

  function studentsTab(students) {
    if (!students.length) return h('p', { class: 'empty' }, 'No students yet. Share the board link (📤 Share on the board).');
    const tl = tasks();
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Student', 'Class', 'Joined', 'Posts', 'Tasks done', 'Quiz score', '🎤', 'Last active', ''].map((t) => h('th', null, t)))),
      h('tbody', null, students.map((s) => {
        const work = byStudent(s);
        const done = tl.filter((t) => responseOf(s, t)).length;
        const as = m.assessments.filter((a) => s.ids.includes(a.student_id) && a.auto_total);
        const sc = as.length ? `${as.reduce((x, a) => x + Number(a.auto_score), 0)} / ${as.reduce((x, a) => x + Number(a.auto_total), 0)}` : '—';
        const last = work.map((p) => p.updated_at).sort().pop();
        const mem = m.members.find((x) => s.ids.includes(x.user_id));
        return h('tr', { class: s.joined ? '' : 'muted-row' },
          h('td', null, h('strong', null, s.name), s.ids.length > 1 ? h('small', { class: 'muted' }, ` (${s.ids.length} devices)`) : null),
          h('td', null, s.class_name || ''), h('td', null, mem ? fmtDateTime(mem.joined_at) : 'Not joined'),
          h('td', null, String(work.filter((p) => p.kind === 'note').length)),
          h('td', null, `${done} / ${tl.length}`), h('td', null, sc),
          h('td', null, String(work.filter((p) => (p.attachments || []).some((a) => (a.type || '').startsWith('audio'))).length)),
          h('td', null, last ? fmtDateTime(last) : '—'),
          h('td', null, s.joined ? h('button', { class: 'btn btn-sm', onclick: () => studentWork(s) }, 'View work') : null));
      }))));
  }

  function studentWork(s) {
    const box = h('div', { class: 'stack' });
    const md = modal({ title: `🧑‍🎓 ${s.name}`, size: 'large', body: box });
    const drawW = () => {
      const work = byStudent(s).sort((a, b) => b.created_at.localeCompare(a.created_at));
      add(clear(box), 
        work.length ? work.map((p) => {
          if (p.kind === 'response') {
            const parent = m.posts.find((x) => x.id === p.parent_id);
            return h('div', null, h('h3', null, `📥 ${parent?.title || 'Task'}`), reviewItem(m, p, parent));
          }
          return h('div', { class: 'review-item' }, h('h3', null, `📝 ${p.title || 'Post'}`), p.body ? h('div', { class: 'answer-text' }, p.body) : null,
            (p.attachments || []).length ? h('div', { class: 'attachments' }, p.attachments.map((a) => renderAttachment(a))) : null,
            h('small', { class: 'muted' }, fmtDateTime(p.created_at), p.status !== 'approved' ? ` · ${p.status}` : ''));
        }) : h('p', { class: 'muted' }, 'No work yet.'),
        h('div', { class: 'danger-zone' }, h('button', { class: 'btn btn-danger btn-sm', onclick: async () => {
          if (!(await confirmBox(`Remove ${s.name} from this board? Their work stays, but they can no longer open the board on that device.`, { danger: true, okText: 'Remove' }))) return;
          try { for (const id of s.ids) await q(sb.from('board_members').delete().eq('board_id', boardId).eq('user_id', id)); md.close(); m.refresh(); toast('Removed', 'ok'); } catch (e) { toast(errMsg(e), 'error'); }
        } }, 'Remove student from board')));
    };
    drawW();
    const off = m.onChange(deferWhileEditing(box, drawW)); const c = md.close; md.close = () => { off(); c(); };
  }

  function rosterTab(students) {
    const ta = h('textarea', { class: 'input', rows: 12, placeholder: 'Sara\nOmar\nLayla\n…' }); ta.value = m.roster.join('\n');
    const save = h('button', { class: 'btn btn-primary', onclick: async () => {
      const names = [...new Set(ta.value.split('\n').map((s) => s.trim()).filter(Boolean))].slice(0, 200);
      busy(save, true);
      try { await q(sb.from('board_secrets').update({ roster: names }).eq('board_id', boardId)); toast('Class list saved ✅', 'ok'); await m.refresh(); }
      catch (e) { toast(errMsg(e), 'error'); } finally { busy(save, false); }
    } }, '💾 Save class list');
    const notJoined = students.filter((s) => !s.joined);
    const extra = m.members.filter((x) => m.roster.length && !m.roster.some((n) => normName(n) === normName(x.display_name)));
    return h('div', { class: 'grid-2' },
      h('section', null, h('h3', null, 'Your class list'), h('p', { class: 'hint' }, 'Type one first name per line, exactly as students will type it. This lets you see who has NOT joined or submitted. Only you can see this list.'), ta, save),
      h('section', null,
        h('h3', null, `🙋 Not joined yet (${notJoined.length})`), notJoined.length ? h('p', null, notJoined.map((s) => s.name).join(', ')) : h('p', { class: 'muted' }, m.roster.length ? 'Everyone on the list has joined 🎉' : 'Add your class list to see this.'),
        extra.length ? [h('h3', null, `❓ Joined but not on the list (${extra.length})`), h('p', { class: 'hint' }, 'Check spelling — or a student may have typed a nickname.'), h('p', null, extra.map((x) => x.display_name).join(', '))] : null));
  }

  function exportTab(students) {
    let tl = tasks();
    const results = () => {
      tl = tasks();
      const rows = [['Student', 'Class', 'Task', 'Task type', 'Submitted', 'Submitted at', 'Status', 'Auto score', 'Auto total', 'Mark', 'Teacher feedback', 'Written answer', 'Answers', 'Has recording']];
      students.forEach((s) => tl.forEach((t) => {
        const r = responseOf(s, t);
        const a = r ? m.assessmentFor(r.id) : null;
        const qs = t.data?.questions || [];
        rows.push([s.name, s.class_name || '', t.title || KIND_INFO[t.kind].label, KIND_INFO[t.kind].label, r ? 'Yes' : 'No', r ? fmtDateTime(r.updated_at) : '', r ? r.status : '',
          a?.auto_total ? a.auto_score : '', a?.auto_total || '', a?.mark || '', a?.feedback || '', r?.body || '',
          r ? (r.data?.answers || []).map((x, i) => formatAnswer(qs[i], x)).join(' | ') : '',
          r && (r.attachments || []).some((x) => (x.type || '').startsWith('audio')) ? 'Yes' : '']);
      }));
      return rows;
    };
    const summary = () => {
      tl = tasks();
      const rows = [['Student', 'Class', 'Joined at', 'Posts', 'Tasks done', 'Tasks total', 'Tasks not done', 'Quiz points', 'Quiz points possible', 'Recordings', 'Comments']];
      students.forEach((s) => {
        const work = byStudent(s);
        const done = tl.filter((t) => responseOf(s, t));
        const as = m.assessments.filter((a) => s.ids.includes(a.student_id) && a.auto_total);
        const mem = m.members.find((x) => s.ids.includes(x.user_id));
        rows.push([s.name, s.class_name || '', mem ? fmtDateTime(mem.joined_at) : 'Not joined', work.filter((p) => p.kind === 'note').length, done.length, tl.length,
          tl.filter((t) => !done.includes(t)).map((t) => t.title).join(' | '),
          as.reduce((x, a) => x + Number(a.auto_score), 0), as.reduce((x, a) => x + Number(a.auto_total), 0),
          work.filter((p) => (p.attachments || []).some((a) => (a.type || '').startsWith('audio'))).length,
          m.comments.filter((c) => s.ids.includes(c.author_id)).length]);
      });
      return rows;
    };
    const fname = (k) => `${board.title.replace(/[^\w]+/g, '_').slice(0, 40)}_${k}_${new Date().toISOString().slice(0, 10)}.csv`;
    return h('div', { class: 'stack export' },
      h('p', null, 'CSV files open directly in Microsoft Excel (and Google Sheets). Marks are only what you typed — nothing is graded for just taking part.'),
      h('button', { class: 'btn btn-primary btn-lg', onclick: async (e) => { busy(e.currentTarget, true, 'Preparing…'); await load(); busy(e.currentTarget, false); students = people(); downloadFile(fname('results'), toCSV(results())); } }, '⬇️ Results — one row per student per task'),
      h('button', { class: 'btn btn-lg', onclick: async (e) => { busy(e.currentTarget, true, 'Preparing…'); await load(); busy(e.currentTarget, false); students = people(); downloadFile(fname('participation'), toCSV(summary())); } }, '⬇️ Participation summary — one row per student'));
  }

  await load();
  draw();
  redraw = deferWhileEditing(content, draw);
  const soon = debounce(() => m.refresh().catch(console.warn), 500);
  const ch = sb.channel(`monitor-${boardId}-${Math.random().toString(36).slice(2, 8)}`);
  ['posts', 'assessments', 'board_members'].forEach((t) => ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `board_id=eq.${boardId}` }, soon));
  ch.subscribe();
  const poll = setInterval(() => { if (document.visibilityState === 'visible') soon(); }, 30000);
  return () => { try { sb.removeChannel(ch); } catch { /* */ } clearInterval(poll); };
}
