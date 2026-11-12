// Making posts: student/teacher notes, teacher English content, student answers, spelling practice.
import { sb, q } from '../supa.js';
import { h, add, clear, modal, toast, errMsg, busy, field, toggle, NOTE_COLORS, KIND_INFO } from '../ui.js';
import { uploadFile, checkFile, removeFiles, ACCEPT, renderAttachment, fileCat } from '../files.js';
import { createRecorder, createDrawpad, blobToFile, speak, recordingSupported } from '../media.js';
import { setting } from './boardForm.js';

/** Attachment picker: upload files, record audio, draw. */
function attachPanel({ existing = [], uploads = true, audio = true, draw = true, max = 10 }) {
  let kept = [...existing];
  const removed = [];
  const fresh = []; // { file, label }
  const list = h('div', { class: 'att-list' });
  const extra = h('div', { class: 'att-extra' });
  const fileInput = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, onchange: () => {
    [...fileInput.files].forEach((f) => {
      const c = checkFile(f);
      if (!c.ok) { toast(c.error, 'error'); return; }
      if (kept.length + fresh.length >= max) { toast(`Up to ${max} attachments`, 'error'); return; }
      fresh.push({ file: f, label: f.name });
    });
    fileInput.value = ''; drawList();
  } });
  function drawList() {
    clear(list);
    kept.forEach((a, i) => add(list, h('div', { class: 'att-item' }, renderAttachment(a, { compact: true }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { removed.push(a); kept.splice(i, 1); drawList(); } }, '✕'))));
    fresh.forEach((f, i) => add(list, h('div', { class: 'att-item new' },
      h('span', null, f.file.type.startsWith('audio') ? '🎤 ' : f.file.type.startsWith('image') ? '🖼️ ' : '📎 ', f.label),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { fresh.splice(i, 1); drawList(); } }, '✕'))));
  }
  let rec = null;
  const showRecorder = () => {
    clear(extra); if (rec) rec.destroy();
    rec = createRecorder({ submitLabel: '➕ Add this recording', onSubmit: async (blob) => {
      fresh.push({ file: blobToFile(blob, 'recording'), label: 'Voice recording' }); drawList(); clear(extra); rec.destroy(); rec = null;
    } });
    add(extra, rec.el);
  };
  const showDraw = () => {
    clear(extra); if (rec) { rec.destroy(); rec = null; }
    const pad = createDrawpad();
    add(extra, pad.el, h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: () => clear(extra) }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
        if (pad.isEmpty()) { toast('Draw something first 🎨', 'error'); return; }
        const b = await pad.toBlob(); fresh.push({ file: blobToFile(b, 'drawing'), label: 'My drawing' }); drawList(); clear(extra);
      } }, '➕ Add drawing')));
  };
  const buttons = h('div', { class: 'att-buttons' },
    uploads ? h('button', { type: 'button', class: 'btn btn-soft', onclick: () => fileInput.click() }, '📷 Picture / file') : null,
    audio ? h('button', { type: 'button', class: 'btn btn-soft', onclick: showRecorder }, '🎤 Record') : null,
    draw ? h('button', { type: 'button', class: 'btn btn-soft', onclick: showDraw }, '✏️ Draw') : null,
    fileInput);
  drawList();
  return {
    el: h('div', { class: 'attach-panel' }, buttons, extra, list),
    count: () => kept.length + fresh.length,
    hasAudio: () => kept.some((a) => fileCat(a) === 'audio') || fresh.some((f) => (f.file.type || '').startsWith('audio')),
    destroy: () => rec && rec.destroy(),
    async commit({ boardId, teacher }) {
      const out = [...kept];
      for (const f of fresh) out.push(await uploadFile(f.file, { boardId, teacher, name: f.label === 'Voice recording' || f.label === 'My drawing' ? f.file.name : f.label }));
      return { attachments: out, removed: removed.map((a) => a.path) };
    },
  };
}

function placementFields(ctx, post, sectionId) {
  const layout = ctx.board.layout;
  const sections = ctx.board.sections || [];
  const out = { el: [], get: () => ({}) };
  let sec = null, date = null;
  if (layout === 'shelf' && sections.length) {
    sec = h('select', { class: 'input' }, sections.map((s) => h('option', { value: s.id, selected: s.id === (post?.section_id || sectionId) }, s.title)));
    out.el.push(field('Column', sec));
  }
  if (layout === 'timeline') {
    date = h('input', { class: 'input', type: 'date', value: post?.event_date || new Date().toISOString().slice(0, 10) });
    out.el.push(field('Date on the timeline', date));
  }
  out.get = () => ({ ...(sec ? { section_id: sec.value } : {}), ...(date ? { event_date: date.value || null } : {}) });
  return out;
}

function canvasSpot(ctx) {
  const n = ctx.posts.filter((p) => !p.parent_id).length;
  return { pos_x: 40 + (n % 5) * 290 + Math.floor(Math.random() * 30), pos_y: 40 + Math.floor(n / 5) * 260 + Math.floor(Math.random() * 30) };
}

/** Post (note) composer for students and teachers. */
export function openComposer(ctx, { post = null, sectionId = null } = {}) {
  const teacher = ctx.isOwner;
  const title = h('input', { class: 'input input-lg', maxlength: 200, placeholder: 'Title (optional)', value: post?.title || '' });
  const text = h('textarea', { class: 'input input-lg', rows: 5, maxlength: 20000, placeholder: teacher ? 'Write something…' : 'Write your answer or idea here…' });
  text.value = post?.body || '';
  const link = h('input', { class: 'input', type: 'url', placeholder: 'https://…', value: post?.link_url || '' });
  const video = h('input', { class: 'input', type: 'url', placeholder: 'YouTube or Vimeo link', value: post?.video_url || '' });
  let color = post?.data?.color || (teacher ? 'white' : 'yellow');
  const colors = h('div', { class: 'color-pick', role: 'radiogroup', 'aria-label': 'Colour' }, NOTE_COLORS.map((c) =>
    h('button', { type: 'button', class: `color-dot note-${c} ${c === color ? 'on' : ''}`, 'aria-label': c, onclick: (e) => {
      color = c; colors.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('on')); e.currentTarget.classList.add('on');
    } })));
  const panel = attachPanel({ existing: post?.attachments || [], uploads: teacher || setting(ctx.board, 'allow_uploads'), audio: teacher || setting(ctx.board, 'allow_audio') });
  const place = placementFields(ctx, post, sectionId);
  const more = h('details', { class: 'more-opts' }, h('summary', null, '🔗 Add a link or video'), field('Website link', link), field('Video link', video));
  if (post?.link_url || post?.video_url) more.open = true;

  const save = h('button', { class: 'btn btn-primary btn-lg', onclick: async () => {
    if (!title.value.trim() && !text.value.trim() && !panel.count() && !link.value.trim() && !video.value.trim()) { toast('Write something or add a picture first ✏️', 'error'); return; }
    busy(save, true, 'Posting…');
    try {
      const { attachments, removed } = await panel.commit({ boardId: ctx.board.id, teacher });
      const row = { title: title.value.trim(), body: text.value.trim(), link_url: link.value.trim() || null, video_url: video.value.trim() || null,
        attachments, data: { color }, ...place.get() };
      if (post) await q(sb.from('posts').update(row).eq('id', post.id));
      else {
        Object.assign(row, { board_id: ctx.board.id, kind: 'note', author_name: ctx.myName() });
        if (ctx.board.layout === 'canvas') Object.assign(row, canvasSpot(ctx));
        await q(sb.from('posts').insert(row));
      }
      await removeFiles(removed.filter((p) => p.startsWith('b/')));
      const pendingMsg = !teacher && setting(ctx.board, 'require_approval');
      toast(pendingMsg ? 'Sent! Your teacher will check it soon ⏳' : (post ? 'Saved ✅' : 'Posted! 🎉'), 'ok');
      m.close(); ctx.refresh();
    } catch (e) { toast(errMsg(e), 'error'); busy(save, false); }
  } }, post ? 'Save' : 'Post ✨');
  const m = modal({ title: post ? 'Edit post' : (teacher ? 'New post' : '✨ New post'), size: 'medium', onClose: () => panel.destroy(),
    body: h('div', { class: 'stack composer' }, title, text, panel.el, more, place.el, h('div', null, h('span', { class: 'field-label' }, 'Colour'), colors)),
    actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), save] });
}

const BODY_LABEL = { vocab: 'Notes (optional)', reading: 'Reading passage', spelling: 'Instructions (optional)', grammar: 'Explanation',
  writing: 'Writing prompt / instructions', speaking: 'Speaking prompt / instructions' };

/** Teacher editor for vocabulary, reading, spelling, grammar, writing, speaking. */
export function openTeacherEditor(ctx, kind, post = null, preset = {}) {
  const d = post?.data || {};
  const info = KIND_INFO[kind];
  const title = h('input', { class: 'input input-lg', maxlength: 200, value: post?.title || preset.title || '', placeholder: { vocab: 'e.g. Animals', reading: 'e.g. The Lost Kitten', spelling: 'e.g. Week 5 spelling words',
    grammar: 'e.g. Present simple: he / she / it + s', writing: 'e.g. My best day', speaking: 'e.g. Tell us about your pet' }[kind] });
  const body = h('textarea', { class: 'input', rows: kind === 'reading' ? 10 : 4, maxlength: 20000 }); body.value = post?.body || '';
  const fields = [];
  const get = {};
  let bulk = null;
  if (kind === 'vocab') {
    const word = h('input', { class: 'input input-lg', maxlength: 80, value: d.word || '', placeholder: 'e.g. elephant' });
    const def = h('input', { class: 'input', maxlength: 300, value: d.definition || '', placeholder: 'A very big grey animal with a long nose' });
    const ex = h('input', { class: 'input', maxlength: 300, value: d.example || '', placeholder: 'The elephant drinks water with its trunk.' });
    fields.push(field('Word', word), field('Meaning', def), field('Example sentence', ex));
    get.data = () => ({ word: word.value.trim(), definition: def.value.trim(), example: ex.value.trim() });
    if (!post) {
      bulk = h('textarea', { class: 'input', rows: 5, placeholder: 'cat | a small furry pet | The cat is sleeping.\ndog | an animal that barks | My dog likes to run.' });
      fields.push(h('details', { class: 'more-opts' }, h('summary', null, '⚡ Add many word cards at once'),
        field('One word per line:  word | meaning | example', bulk, 'If you fill this box, one card is made for each line (pictures/recordings below are not used).')));
    }
  }
  if (kind === 'reading') {
    const qs = h('textarea', { class: 'input', rows: 4, placeholder: 'Who found the kitten?\nWhere was the kitten?' }); qs.value = (d.questions || []).join('\n');
    fields.push(field('Comprehension questions (one per line)', qs, 'Students record themselves reading and type their answers.'));
    get.data = () => ({ questions: qs.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20) });
  }
  let makeChallenge = false;
  if (kind === 'spelling') {
    const words = h('textarea', { class: 'input input-lg', rows: 4, placeholder: 'because, friend, school, beautiful' }); words.value = (d.words || []).join(', ');
    fields.push(field('Spelling words (separate with commas or new lines)', words, 'Each word gets a 🔊 listen button automatically.'));
    if (!post) fields.push(toggle('Also make a spelling challenge', false, (v) => { makeChallenge = v; }, 'A test where students hear each word and type it. You open and close it.'));
    get.data = () => ({ words: words.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 40) });
  }
  if (kind === 'grammar') {
    const ex = h('textarea', { class: 'input', rows: 4, placeholder: 'He plays football.\nShe watches TV.' }); ex.value = (d.examples || []).join('\n');
    fields.push(field('Examples (one per line)', ex));
    get.data = () => ({ examples: ex.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20) });
  }
  let share = post ? !!d.share_responses : !!preset.share;
  let open = post ? post.is_open : true;
  const taskOpts = [toggle('Accept answers', open, (v) => { open = v; }, 'Students can respond to this card')];
  if (['writing', 'speaking', 'reading', 'vocab', 'spelling', 'grammar'].includes(kind)) taskOpts.push(toggle('Let the class see each other’s answers', share, (v) => { share = v; }, 'Off = only you see the answers'));
  let minWords = d.min_words || '';
  if (kind === 'writing') { const mw = h('input', { class: 'input input-sm', type: 'number', min: 0, max: 1000, value: minWords }); mw.oninput = () => { minWords = mw.value; }; taskOpts.push(field('Suggested number of words (optional)', mw)); }

  const panel = attachPanel({ existing: post?.attachments || [] });
  const link = h('input', { class: 'input', type: 'url', placeholder: 'https://…', value: post?.link_url || '' });
  const video = h('input', { class: 'input', type: 'url', placeholder: 'YouTube or Vimeo link', value: post?.video_url || '' });
  const place = placementFields(ctx, post, null);

  const save = h('button', { class: 'btn btn-primary btn-lg', onclick: async () => {
    busy(save, true, 'Saving…');
    try {
      if (bulk && bulk.value.trim()) {
        const rows = bulk.value.split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((r) => r[0]);
        let base = Date.now() / 1000;
        await q(sb.from('posts').insert(rows.map(([w, def = '', ex = ''], i) => ({
          board_id: ctx.board.id, kind: 'vocab', author_name: ctx.myName(), title: w, data: { word: w, definition: def, example: ex, share_responses: share },
          is_open: open, sort_order: base + i * 0.001, ...place.get(), ...(ctx.board.layout === 'canvas' ? { pos_x: 40 + (i % 5) * 290, pos_y: 40 + Math.floor(i / 5) * 260 } : {}) }))));
        toast(`${rows.length} word cards made ✅`, 'ok'); m.close(); ctx.refresh(); return;
      }
      const data = { ...(get.data ? get.data() : {}), share_responses: share };
      if (minWords) data.min_words = +minWords;
      if (kind === 'vocab' && !data.word) throw new Error('Type the word');
      if (kind === 'spelling' && !data.words.length) throw new Error('Add at least one spelling word');
      const t = title.value.trim() || (kind === 'vocab' ? data.word : '');
      if (!t && !body.value.trim()) throw new Error('Add a title');
      const { attachments, removed } = await panel.commit({ boardId: ctx.board.id, teacher: true });
      const row = { title: t, body: body.value.trim(), data, is_open: open, attachments, link_url: link.value.trim() || null, video_url: video.value.trim() || null, ...place.get() };
      if (post) await q(sb.from('posts').update(row).eq('id', post.id));
      else {
        Object.assign(row, { board_id: ctx.board.id, kind, author_name: ctx.myName() });
        if (ctx.board.layout === 'canvas') Object.assign(row, canvasSpot(ctx));
        await q(sb.from('posts').insert(row));
        if (makeChallenge) {
          const qs = data.words.map((w) => ({ type: 'spell', prompt: 'Listen and type the word', say: w }));
          const act = (await q(sb.from('posts').insert({ board_id: ctx.board.id, kind: 'activity', author_name: ctx.myName(), title: `${t || 'Spelling'} – challenge`,
            data: { template: 'spelling', questions: qs, allow_retry: false, show_answers: true }, is_open: false, ...place.get() }).select()))[0];
          await q(sb.from('activity_keys').upsert({ post_id: act.id, board_id: ctx.board.id, answers: data.words }));
          toast('Spelling challenge made. It is closed until you open it 🔴', 'ok');
        }
      }
      await removeFiles(removed.filter((p) => p.startsWith('b/')));
      toast('Saved ✅', 'ok'); m.close(); ctx.refresh();
    } catch (e) { toast(errMsg(e), 'error'); busy(save, false); }
  } }, post ? 'Save' : `Add ${info.label.toLowerCase()}`);

  const m = modal({ title: `${info.icon} ${post ? 'Edit' : 'New'} ${info.label.toLowerCase()} card`, size: 'large', onClose: () => panel.destroy(),
    body: h('div', { class: 'form-grid' },
      h('section', null, field('Title', title), fields, field(BODY_LABEL[kind] || 'Text', body)),
      h('section', null,
        h('h3', null, '📎 Pictures, audio & files'),
        h('p', { class: 'hint' }, kind === 'vocab' ? 'Add a picture of the word, and (optional) record how to say it.' : kind === 'reading' ? 'Record or upload yourself reading the passage so students can listen.' : 'Add a picture, recording, PDF, Word or PowerPoint file.'),
        panel.el,
        h('details', { class: 'more-opts' }, h('summary', null, '🔗 Link or video'), field('Website link', link), field('Video link', video)),
        place.el,
        h('h3', null, '📥 Answers'), taskOpts)),
    actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), save] });
}

/** Student answer to a teacher task (vocab, reading, spelling, grammar, writing, speaking). */
export function openResponse(ctx, parent, existing = null) {
  const kind = parent.kind;
  const needsAudio = ['vocab', 'reading', 'spelling', 'speaking'].includes(kind);
  const parts = [];
  parts.push(h('div', { class: 'task-prompt' },
    h('strong', null, `${KIND_INFO[kind].icon} ${parent.title || KIND_INFO[kind].label}`),
    kind === 'vocab' && parent.data?.word ? h('p', { class: 'vocab-word small' }, parent.data.word, ' ', h('button', { type: 'button', class: 'btn-speak', onclick: () => speak(parent.data.word) }, '🔊')) : null,
    kind === 'reading' && parent.body ? h('div', { class: 'passage passage-sm' }, parent.body) : null,
    kind === 'spelling' ? h('p', null, (parent.data?.words || []).join(' · ')) : null,
    ['writing', 'speaking', 'grammar'].includes(kind) && parent.body ? h('p', null, parent.body) : null));

  const hint = { vocab: 'Say the word, then say the example sentence.', reading: 'Read the passage aloud. Then answer the questions.',
    spelling: 'Say each word, then spell it letter by letter: “friend – f-r-i-e-n-d”.', speaking: 'Press Start and talk. Press Stop when you finish.' }[kind];
  let recBlob = null;
  let rec = null;
  const keptAudio = (existing?.attachments || []).filter((a) => fileCat(a) === 'audio');
  if (needsAudio) {
    rec = createRecorder({ prompt: hint, onChange: (b) => { recBlob = b; } });
    parts.push(h('div', { class: 'section-box' }, h('h3', null, '🎤 Your recording'),
      keptAudio.length ? h('div', null, h('p', { class: 'muted small' }, 'Your saved recording (record again to replace it):'), keptAudio.map((a) => renderAttachment(a))) : null,
      rec.el));
  }
  const answers = [];
  if (kind === 'reading' && (parent.data?.questions || []).length) {
    parts.push(h('h3', null, '❓ Answer the questions'));
    parent.data.questions.forEach((qq, i) => {
      const ta = h('textarea', { class: 'input', rows: 2, maxlength: 2000 }); ta.value = existing?.data?.answers?.[i] || '';
      answers.push(ta); parts.push(field(`${i + 1}. ${qq}`, ta));
    });
  }
  const text = h('textarea', { class: `input ${kind === 'writing' ? 'writer' : ''}`, rows: kind === 'writing' ? 10 : 3, maxlength: 20000, spellcheck: 'true',
    placeholder: kind === 'writing' ? 'Start writing here…' : kind === 'grammar' ? 'Write your sentences here…' : 'Anything to add? (optional)' });
  text.value = existing?.body || '';
  const wc = h('span', { class: 'word-count' });
  const countWords = () => { const n = (text.value.trim().match(/\S+/g) || []).length; wc.textContent = `${n} word${n === 1 ? '' : 's'}${parent.data?.min_words ? ` / aim for ${parent.data.min_words}` : ''}`; };
  text.addEventListener('input', countWords); countWords();
  parts.push(field(kind === 'writing' ? '✏️ Your writing' : kind === 'grammar' ? '✏️ Your answer' : '💬 Note', text), kind === 'writing' ? wc : null);
  const allowUp = setting(ctx.board, 'allow_uploads');
  const panel = (kind === 'writing' || kind === 'grammar') ? attachPanel({ existing: existing?.attachments || [], uploads: allowUp, audio: false, draw: allowUp }) : null;
  if (panel) parts.push(h('details', { class: 'more-opts' }, h('summary', null, '🖼️ Add a picture or drawing (optional)'), panel.el));

  const send = h('button', { class: 'btn btn-primary btn-lg', onclick: async () => {
    if (needsAudio && !recBlob && !keptAudio.length) {
      if (!recordingSupported() && text.value.trim()) { /* allow text-only if no microphone */ }
      else { toast('Please record your voice first 🎤', 'error'); return; }
    }
    if (!needsAudio && !text.value.trim() && !(panel && panel.count())) { toast('Please write your answer first ✏️', 'error'); return; }
    busy(send, true, 'Sending…');
    try {
      let attachments = [], removed = [];
      if (panel) ({ attachments, removed } = await panel.commit({ boardId: ctx.board.id, teacher: false }));
      else attachments = [...(existing?.attachments || [])];
      if (recBlob) {
        removed.push(...attachments.filter((a) => fileCat(a) === 'audio').map((a) => a.path));
        attachments = attachments.filter((a) => fileCat(a) !== 'audio');
        attachments.push(await uploadFile(blobToFile(recBlob, 'recording'), { boardId: ctx.board.id, name: 'recording' + (recBlob.type.includes('mp4') ? '.m4a' : '.webm') }));
      }
      const row = { body: text.value.trim(), attachments, data: answers.length ? { answers: answers.map((a) => a.value.trim()) } : {} };
      if (existing) await q(sb.from('posts').update(row).eq('id', existing.id));
      else await q(sb.from('posts').insert({ ...row, board_id: ctx.board.id, kind: 'response', parent_id: parent.id, title: parent.title }));
      await removeFiles(removed.filter((p) => p.startsWith('b/')));
      toast('Sent to your teacher! 🌟', 'ok'); m.close(); ctx.refresh();
    } catch (e) { toast(errMsg(e), 'error'); busy(send, false); }
  } }, needsAudio ? '✅ Submit recording' : '✅ Send my answer');

  const m = modal({ title: existing ? 'Change my answer' : 'My answer', size: 'medium', onClose: () => { rec && rec.destroy(); panel && panel.destroy(); },
    body: h('div', { class: 'stack' }, parts), actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), send] });
}

/** Self-check spelling practice (nothing is saved). */
export function openSpellingPractice(words) {
  const list = [...words].sort(() => Math.random() - 0.5);
  let i = 0, right = 0;
  const box = h('div', { class: 'practice' });
  const m = modal({ title: '🐝 Spelling practice', size: 'medium', body: box });
  function step() {
    clear(box);
    if (i >= list.length) {
      add(box, h('div', { class: 'center stack' }, h('div', { class: 'big-emoji' }, right === list.length ? '🏆' : '🌟'),
        h('h2', null, `You got ${right} out of ${list.length}!`),
        h('button', { class: 'btn btn-primary', onclick: () => { i = 0; right = 0; list.sort(() => Math.random() - 0.5); step(); } }, '🔁 Practise again'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'Finish')));
      return;
    }
    const w = list[i];
    const input = h('input', { class: 'input input-xl center', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Type the word' });
    const result = h('div', { class: 'practice-result', 'aria-live': 'polite' });
    const check = h('button', { class: 'btn btn-primary btn-lg', onclick: () => {
      if (check.dataset.done) { i++; step(); return; }
      const ok = input.value.trim().toLowerCase() === w.toLowerCase();
      if (ok) right++;
      add(clear(result), ok ? h('p', { class: 'ok' }, '✅ Correct! Well done!') : h('p', { class: 'bad' }, '❌ Not quite. It is: ', h('strong', null, w)));
      check.dataset.done = '1'; check.textContent = 'Next ➜';
    } }, 'Check');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check.click(); });
    add(box, h('p', { class: 'muted' }, `Word ${i + 1} of ${list.length}`),
      h('button', { class: 'btn btn-speak-big', onclick: () => speak(w, { rate: 0.75 }) }, '🔊 Listen'),
      input, check, result);
    setTimeout(() => { speak(w, { rate: 0.75 }); input.focus(); }, 300);
  }
  step();
}
