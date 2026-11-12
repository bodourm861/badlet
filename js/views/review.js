// Teacher review of student answers (marks, feedback, approve) + shared class answers for students.
import { sb, q } from '../supa.js';
import { h, add, clear, modal, toast, errMsg, busy, timeAgo, fmtDateTime, normName, KIND_INFO, confirmBox, deferWhileEditing } from '../ui.js';

const drafts = new Map(); // unsaved marks/feedback survive live redraws
import { renderAttachment, removeFiles } from '../files.js';
import { gradeLocal, keyText } from './activities.js';
import { formatAnswer, displayName } from './postcard.js';

export function expectedStudents(ctx) {
  // Everyone who joined + names on the teacher's roster who never joined.
  const seen = new Map();
  (ctx.members || []).forEach((m) => { const k = normName(m.display_name); if (!seen.has(k)) seen.set(k, { name: m.display_name, class_name: m.class_name, ids: [m.user_id], joined: true }); else seen.get(k).ids.push(m.user_id); });
  (ctx.roster || []).forEach((n) => { const k = normName(n); if (k && !seen.has(k)) seen.set(k, { name: n.trim(), class_name: '', ids: [], joined: false }); });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function reviewItem(ctx, r, parent) {
  const a = ctx.assessmentFor(r.id) || {};
  const qs = parent?.data?.questions || [];
  const keys = ctx.keys?.[parent?.id];
  const answers = r.data?.answers || [];
  const graded = parent?.kind === 'activity' && keys ? gradeLocal(qs, keys, answers) : null;
  const dr = drafts.get(r.id);
  const mark = h('input', { class: 'input input-sm mark-input', maxlength: 20, value: dr ? dr.mark : (a.mark || ''), placeholder: 'e.g. 8/10', 'aria-label': 'Mark' });
  const fb = h('textarea', { class: 'input', rows: 2, maxlength: 4000, placeholder: 'Feedback for this student (only they see it)', 'aria-label': 'Feedback' }); fb.value = dr ? dr.feedback : (a.feedback || '');
  const keep = () => drafts.set(r.id, { mark: mark.value, feedback: fb.value });
  mark.addEventListener('input', keep); fb.addEventListener('input', keep);
  const save = h('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
    busy(save, true, 'Saving…');
    try {
      await q(sb.from('assessments').upsert({ post_id: r.id, board_id: r.board_id, student_id: r.author_id, mark: mark.value.trim() || null, feedback: fb.value.trim() || null,
        auto_score: a.auto_score ?? null, auto_total: a.auto_total ?? null }, { onConflict: 'post_id' }));
      drafts.delete(r.id); toast('Feedback saved ✅', 'ok'); await ctx.refresh();
    } catch (e) { toast(errMsg(e), 'error'); } finally { busy(save, false); }
  } }, '💾 Save');
  const setStatus = async (status) => { try { await q(sb.from('posts').update({ status }).eq('id', r.id)); await ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); } };
  return h('div', { class: `review-item ${r.status !== 'approved' ? 'is-' + r.status : ''}` },
    h('div', { class: 'row space' },
      h('div', null, h('strong', null, r.author_name), h('span', { class: 'muted small' }, ` · ${fmtDateTime(r.updated_at || r.created_at)}`)),
      h('div', { class: 'row' },
        a.auto_total ? h('span', { class: 'chip' }, `🎯 ${a.auto_score}/${a.auto_total}`) : null,
        r.status === 'pending' ? h('span', { class: 'status-chip st-pending' }, '⏳ Waiting') : r.status === 'rejected' ? h('span', { class: 'status-chip st-rejected' }, '🚫 Rejected') : null,
        r.status !== 'approved' ? h('button', { class: 'btn btn-sm btn-ok', onclick: () => setStatus('approved') }, '✅ Approve') : null,
        r.status !== 'rejected' ? h('button', { class: 'btn btn-sm', onclick: () => setStatus('rejected') }, '🚫 Reject') : null,
        h('button', { class: 'icon-btn', 'aria-label': 'Delete answer', onclick: async () => {
          if (!(await confirmBox(`Delete ${r.author_name}'s answer?`, { okText: 'Delete', danger: true }))) return;
          try { await q(sb.from('posts').delete().eq('id', r.id)); await removeFiles((r.attachments || []).map((x) => x.path).filter((p) => p.startsWith('b/'))); await ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); }
        } }, '🗑️'))),
    r.body ? h('div', { class: 'answer-text' }, r.body) : null,
    answers.length ? h('ol', { class: 'answer-list' }, answers.map((ans, i) => {
      const qq = qs[i];
      const ok = graded ? graded.results[i] : null;
      return h('li', { class: ok === true ? 'ok' : ok === false ? 'bad' : '' },
        qq ? h('div', { class: 'muted small' }, typeof qq === 'string' ? qq : (qq.type === 'spell' ? `Spell: ${qq.say}` : qq.prompt)) : null,
        h('div', null, ok === true ? '✅ ' : ok === false ? '❌ ' : '', formatAnswer(qq, ans),
          ok === false && keys ? h('span', { class: 'correct-ans' }, `  ✔ ${keyText(qq, keys[i])}`) : null));
    })) : null,
    (r.attachments || []).length ? h('div', { class: 'attachments' }, r.attachments.map((x) => renderAttachment(x))) : null,
    h('div', { class: 'mark-row' }, h('label', null, 'Mark ', mark), fb, save));
}

export function openResponses(ctx, parent) {
  const box = h('div', { class: 'review' });
  let filter = 'all';
  const m = modal({ title: `📥 Answers: ${parent.title || KIND_INFO[parent.kind].label}`, size: 'large', body: box });
  const draw = () => {
    const fresh = ctx.posts.find((x) => x.id === parent.id) || parent;
    const list = ctx.responsesFor(parent.id).sort((a, b) => a.author_name.localeCompare(b.author_name));
    const shown = list.filter((r) => filter === 'all' || r.status === 'pending');
    const done = new Set(list.map((r) => r.author_id));
    const doneNames = new Set(list.map((r) => normName(r.author_name)));
    const missing = expectedStudents(ctx).filter((s) => !s.ids.some((id) => done.has(id)) && !doneNames.has(normName(s.name)));
    add(clear(box), 
      h('div', { class: 'row space' },
        h('div', { class: 'row' },
          h('span', { class: 'chip' }, `✅ ${done.size} answered`),
          h('span', { class: 'chip chip-warn' }, `⏳ ${list.filter((r) => r.status === 'pending').length} waiting`),
          h('span', { class: 'chip' }, `🙋 ${missing.length} not yet`)),
        h('div', { class: 'row' },
          h('select', { class: 'input input-sm', onchange: (e) => { filter = e.target.value; draw(); } },
            h('option', { value: 'all', selected: filter === 'all' }, 'All answers'), h('option', { value: 'pending', selected: filter === 'pending' }, 'Waiting for approval')),
          h('button', { class: `btn btn-sm ${fresh.is_open ? 'btn-open' : 'btn-closed'}`, onclick: async () => {
            try { await q(sb.from('posts').update({ is_open: !fresh.is_open }).eq('id', fresh.id)); await ctx.refresh(); } catch (e) { toast(errMsg(e), 'error'); }
          } }, fresh.is_open ? '🟢 Open — click to close' : '🔴 Closed — click to open'),
          list.some((r) => r.status === 'pending') ? h('button', { class: 'btn btn-sm btn-ok', onclick: async () => {
            try { await q(sb.from('posts').update({ status: 'approved' }).eq('parent_id', parent.id).eq('status', 'pending')); await ctx.refresh(); toast('All approved ✅', 'ok'); } catch (e) { toast(errMsg(e), 'error'); }
          } }, '✅ Approve all') : null)),
      missing.length ? h('details', { class: 'missing' }, h('summary', null, `🙋 Not submitted yet (${missing.length})`),
        h('p', null, missing.map((s) => s.name + (s.joined ? '' : ' (not joined)')).join(', '))) : null,
      shown.length ? shown.map((r) => reviewItem(ctx, r, fresh)) : h('p', { class: 'empty muted' }, 'No answers yet.'));
  };
  draw();
  const off = ctx.onChange(deferWhileEditing(box, draw));
  const close = m.close; m.close = () => { off(); close(); };
}

export function openSharedAnswers(ctx, parent) {
  const list = ctx.responsesFor(parent.id).filter((r) => r.visibility === 'board' && r.status === 'approved');
  modal({ title: `👀 Class answers: ${parent.title}`, size: 'large', body: h('div', { class: 'answer-cards' },
    list.map((r) => h('article', { class: 'post-card note-white' },
      h('div', { class: 'card-head' }, h('span', { class: 'avatar' }, displayName(r, ctx).charAt(0)), h('div', { class: 'card-who' }, h('strong', null, displayName(r, ctx)), h('small', null, timeAgo(r.created_at)))),
      h('div', { class: 'card-body' }, r.body ? h('p', { class: 'card-text' }, r.body) : null,
        (r.attachments || []).length ? h('div', { class: 'attachments' }, r.attachments.map((x) => renderAttachment(x))) : null)))) });
}
