// Activity builder (teacher) and activity player (students + teacher preview).
// Correct answers are stored in the teacher-only activity_keys table and checked on the server.
import { sb, q } from '../supa.js';
import { h, add, clear, modal, toast, errMsg, busy, field, toggle } from '../ui.js';
import { uploadFile, checkFile, fileUrl } from '../files.js';
import { speak } from '../media.js';

export const ACTIVITY_TEMPLATES = {
  vocab:      { icon: '🔤', label: 'Vocabulary challenge', type: 'mcq', help: 'Show a word or meaning; students pick the right answer.' },
  picture:    { icon: '🖼️', label: 'Picture identification', type: 'mcq', help: 'Add a picture to each question; students choose the word.' },
  build:      { icon: '🧱', label: 'Sentence building', type: 'build', help: 'Type a correct sentence; students put the mixed-up words in order.' },
  grammar:    { icon: '🧩', label: 'Grammar quiz', type: 'mcq', help: 'Mix multiple choice, fill-in-the-blank and sentence correction.' },
  spelling:   { icon: '🐝', label: 'Spelling challenge', type: 'spell', help: 'Students hear each word and type it. Open it when you are ready.' },
  reading:    { icon: '📖', label: 'Reading comprehension', type: 'mcq', help: 'Questions about a reading passage on this board.' },
  truefalse:  { icon: '✔️', label: 'True or False', type: 'tf', help: 'Statements students mark true or false.' },
  exit:       { icon: '🚪', label: 'Exit ticket', type: 'short', help: 'Quick questions at the end of the lesson. You read the answers.' },
  quiz:       { icon: '🎯', label: 'Quiz', type: 'mcq', help: '' },
};
export const QTYPES = {
  mcq: 'Multiple choice', tf: 'True / False', fill: 'Fill in the blank', correct: 'Correct the sentence',
  spell: 'Spelling (listen & type)', build: 'Build the sentence', short: 'Open answer (you mark it)',
};

function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function shuffledWords(sentence) {
  const w = sentence.trim().split(/\s+/).filter(Boolean);
  if (w.length < 2) return w;
  let s = shuffle(w); let tries = 0;
  while (s.join(' ') === w.join(' ') && tries++ < 10) s = shuffle(w);
  return s;
}

// Same rules as norm_answer() in the database.
export function normAnswer(t, strict = false) {
  let s = String(t ?? '').replace(/[’‘]/g, "'").trim();
  if (strict) return s.replace(/\s+/g, ' ');
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?,;:]+$/, '');
}
export function gradeLocal(questions, keys, answers) {
  let score = 0, total = 0;
  const results = questions.map((qq, i) => {
    const k = keys?.[i];
    if (qq.type === 'short' || k === null || k === undefined) return null;
    total++;
    const a = answers[i];
    let ok = false;
    if (a !== null && a !== undefined && a !== '') {
      if (qq.type === 'mcq' || qq.type === 'tf') ok = String(a) === String(k);
      else {
        const strict = qq.type === 'correct' || qq.type === 'build';
        ok = String(k).split('|').some((alt) => normAnswer(a, strict) === normAnswer(alt, strict));
      }
    }
    if (ok) score++;
    return ok;
  });
  return { score, total, results };
}

export function keyText(qq, k) {
  if (k === null || k === undefined) return '';
  if (qq.type === 'mcq') return qq.choices?.[k] ?? '';
  if (qq.type === 'tf') return k ? 'True' : 'False';
  return String(k).split('|')[0];
}

/** Teacher: create or edit an activity. */
export async function openActivityEditor(ctx, post = null, startTemplate = null) {
  if (!post && !startTemplate) return chooseTemplate(ctx);
  const template = post?.data?.template || startTemplate || 'quiz';
  const T = ACTIVITY_TEMPLATES[template] || ACTIVITY_TEMPLATES.quiz;
  let keys = [];
  if (post) { const r = await q(sb.from('activity_keys').select('answers').eq('post_id', post.id)); keys = r[0]?.answers || []; }
  const questions = post ? (post.data.questions || []).map((qq, i) => ({ ...qq, answer: keys[i] ?? null }))
    : [newQuestion(T.type)];
  const title = h('input', { class: 'input input-lg', maxlength: 200, value: post?.title || T.label, placeholder: 'Activity title' });
  const instr = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: 'Instructions for students (optional)' }); instr.value = post?.body || '';
  let allowRetry = post ? post.data.allow_retry !== false : template !== 'spelling';
  let showAnswers = post ? post.data.show_answers !== false : true;
  let isOpen = post ? post.is_open : template !== 'spelling';
  const qList = h('div', { class: 'q-list' });

  function newQuestion(type) {
    return { type, prompt: type === 'spell' ? 'Listen and type the word' : type === 'build' ? 'Put the words in the right order' : '',
      choices: type === 'mcq' ? ['', '', ''] : undefined, answer: type === 'tf' ? true : type === 'mcq' ? 0 : '' };
  }

  function drawQuestions() {
    clear(qList);
    questions.forEach((qq, i) => add(qList, questionEditor(qq, i)));
    add(qList, h('div', { class: 'row' }, Object.entries(QTYPES).filter(([k]) => template !== 'spelling' || k === 'spell').map(([k, v]) =>
      h('button', { type: 'button', class: 'btn btn-soft btn-sm', onclick: () => { questions.push(newQuestion(k)); drawQuestions(); } }, `＋ ${v}`))));
  }

  function questionEditor(qq, i) {
    const box = h('div', { class: 'q-edit' });
    const typeSel = h('select', { class: 'input input-sm', onchange: () => { const n = newQuestion(typeSel.value); n.prompt = qq.prompt && !['Listen and type the word', 'Put the words in the right order'].includes(qq.prompt) ? qq.prompt : n.prompt; questions[i] = n; drawQuestions(); } },
      Object.entries(QTYPES).map(([k, v]) => h('option', { value: k, selected: k === qq.type }, v)));
    const head = h('div', { class: 'row space' }, h('strong', null, `Question ${i + 1}`), typeSel,
      h('span', { class: 'row' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]]; drawQuestions(); } }, '⬆️'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move down', disabled: i === questions.length - 1, onclick: () => { [questions[i + 1], questions[i]] = [questions[i], questions[i + 1]]; drawQuestions(); } }, '⬇️'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete question', onclick: () => { questions.splice(i, 1); drawQuestions(); } }, '🗑️')));
    const promptLabel = { mcq: 'Question', tf: 'Statement', fill: 'Sentence with ___ for the gap', correct: 'Sentence with a mistake', spell: 'Instruction', build: 'Instruction', short: 'Question' }[qq.type];
    const prompt = h('input', { class: 'input', maxlength: 500, value: qq.prompt || '', placeholder: { fill: 'I ___ to school every day.', correct: 'she go to school.', tf: 'A cat can fly.', mcq: 'Which animal says “moo”?' }[qq.type] || '',
      oninput: (e) => { qq.prompt = e.target.value; } });
    add(box, head, field(promptLabel, prompt));
    // picture
    const imgWrap = h('div', { class: 'q-img' });
    const drawImg = async () => { clear(imgWrap); if (qq.image) { const u = await fileUrl(qq.image); add(imgWrap, h('img', { src: u || '', alt: '' }), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { delete qq.image; drawImg(); } }, 'Remove picture')); } };
    const imgInput = h('input', { type: 'file', accept: 'image/*', class: 'input input-sm', onchange: async () => {
      const f = imgInput.files[0]; if (!f) return;
      const c = checkFile(f, ['image']); if (!c.ok) { toast(c.error, 'error'); return; }
      try { qq.image = (await uploadFile(f, { teacher: true })).path; drawImg(); } catch (e) { toast(errMsg(e), 'error'); }
    } });
    if (qq.type !== 'spell') add(box, h('details', { class: 'more-opts', open: !!qq.image || template === 'picture' }, h('summary', null, '🖼️ Picture (optional)'), imgInput, imgWrap));
    drawImg();

    if (qq.type === 'mcq') {
      const ch = h('div', { class: 'choices-edit' });
      const drawChoices = () => {
        clear(ch);
        qq.choices.forEach((c, ci) => add(ch, h('div', { class: 'row' },
          h('input', { type: 'radio', name: `ans-${i}-${Math.random()}`, checked: qq.answer === ci, 'aria-label': 'Correct answer', onchange: () => { qq.answer = ci; } }),
          h('input', { class: 'input', maxlength: 200, value: c, placeholder: `Choice ${ci + 1}`, oninput: (e) => { qq.choices[ci] = e.target.value; } }),
          qq.choices.length > 2 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove choice', onclick: () => { qq.choices.splice(ci, 1); if (qq.answer === ci) qq.answer = 0; else if (qq.answer > ci) qq.answer--; drawChoices(); } }, '✕') : null)));
        add(ch, h('div', { class: 'row' },
          qq.choices.length < 6 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { qq.choices.push(''); drawChoices(); } }, '＋ Choice') : null,
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: qq.answer === null, onchange: (e) => { qq.answer = e.target.checked ? null : 0; drawChoices(); } }), ' No right answer (opinion / feelings)')));
      };
      drawChoices();
      add(box, h('div', null, h('span', { class: 'field-label' }, 'Choices — select the correct one'), ch));
    } else if (qq.type === 'tf') {
      add(box, h('div', { class: 'row' }, h('span', { class: 'field-label' }, 'Correct answer:'),
        ['True', 'False'].map((lbl) => h('label', { class: 'check' }, h('input', { type: 'radio', name: `tf-${i}-${Math.random()}`, checked: qq.answer === (lbl === 'True'), onchange: () => { qq.answer = lbl === 'True'; } }), ` ${lbl}`))));
    } else if (qq.type === 'short') {
      add(box, h('p', { class: 'hint' }, 'No automatic checking — you read and mark these answers.'));
    } else {
      const label = { fill: 'Correct word(s) for the gap', correct: 'Correct sentence', spell: 'Word to spell (students hear it, they do not see it)', build: 'Correct sentence' }[qq.type];
      const hint = { fill: 'Use | for other accepted answers, e.g. go|walk', correct: 'Capital letters and punctuation are checked exactly. Use | for other accepted versions.', spell: 'The computer voice reads this word aloud.', build: 'Words are mixed up automatically for students.' }[qq.type];
      add(box, field(label, h('input', { class: 'input', maxlength: 300, value: qq.answer ?? '', oninput: (e) => { qq.answer = e.target.value; } }), hint));
    }
    return box;
  }

  const save = h('button', { class: 'btn btn-primary btn-lg', onclick: async () => {
    try {
      if (!title.value.trim()) throw new Error('Add a title');
      if (!questions.length) throw new Error('Add at least one question');
      const pub = [], ans = [];
      questions.forEach((qq, i) => {
        const n = i + 1;
        if (qq.type !== 'spell' && qq.type !== 'build' && !String(qq.prompt || '').trim() && !qq.image) throw new Error(`Question ${n}: write the question`);
        if (qq.type === 'fill' && !/_{2,}/.test(qq.prompt)) throw new Error(`Question ${n}: put ___ where the gap is`);
        const p = { type: qq.type, prompt: String(qq.prompt || '').trim() };
        if (qq.image) p.image = qq.image;
        if (qq.type === 'mcq') {
          const choices = qq.choices.map((c) => c.trim());
          if (choices.filter(Boolean).length < 2 || choices.some((c) => !c)) throw new Error(`Question ${n}: fill in every choice (at least 2)`);
          p.choices = choices; ans.push(qq.answer === null ? null : qq.answer);
        } else if (qq.type === 'tf') ans.push(!!qq.answer);
        else if (qq.type === 'short') ans.push(null);
        else {
          const a = String(qq.answer || '').trim();
          if (!a) throw new Error(`Question ${n}: type the correct answer`);
          if (qq.type === 'spell') p.say = a.split('|')[0];
          if (qq.type === 'build') p.words = shuffledWords(a.split('|')[0]);
          ans.push(a);
        }
        pub.push(p);
      });
      busy(save, true, 'Saving…');
      const data = { template, questions: pub, allow_retry: allowRetry, show_answers: showAnswers };
      let id = post?.id;
      if (post) await q(sb.from('posts').update({ title: title.value.trim(), body: instr.value.trim(), data, is_open: isOpen }).eq('id', id));
      else {
        const row = { board_id: ctx.board.id, kind: 'activity', author_name: ctx.myName(), title: title.value.trim(), body: instr.value.trim(), data, is_open: isOpen };
        if (ctx.board.layout === 'canvas') Object.assign(row, { pos_x: 60, pos_y: 60 });
        id = (await q(sb.from('posts').insert(row).select()))[0].id;
      }
      await q(sb.from('activity_keys').upsert({ post_id: id, board_id: ctx.board.id, answers: ans }));
      toast(isOpen ? 'Activity saved and open 🟢' : 'Activity saved. It is closed until you open it 🔴', 'ok');
      m.close(); ctx.refresh();
    } catch (e) { toast(errMsg(e), 'error'); busy(save, false); }
  } }, 'Save activity');

  drawQuestions();
  const m = modal({ title: `${T.icon} ${post ? 'Edit' : 'New'} ${T.label.toLowerCase()}`, size: 'large',
    body: h('div', { class: 'stack' },
      T.help ? h('p', { class: 'hint' }, T.help) : null,
      field('Title', title), field('Instructions', instr),
      h('div', { class: 'toggles inline' },
        toggle('Open now', isOpen, (v) => { isOpen = v; }, 'Students can start it'),
        toggle('Allow another try', allowRetry, (v) => { allowRetry = v; }),
        toggle('Show correct answers after submitting', showAnswers, (v) => { showAnswers = v; })),
      h('h3', null, 'Questions'), qList),
    actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), save] });
}

function chooseTemplate(ctx) {
  const m = modal({ title: '🎯 Choose an activity', size: 'large', body: h('div', { class: 'template-grid' },
    Object.entries(ACTIVITY_TEMPLATES).filter(([k]) => k !== 'quiz').map(([k, t]) => h('button', { class: 'template-card', onclick: () => { m.close(); openActivityEditor(ctx, null, k); } },
      h('span', { class: 'big-emoji' }, t.icon), h('strong', null, t.label), h('small', null, t.help))),
    h('button', { class: 'template-card', onclick: () => { m.close(); brainstorm(ctx); } },
      h('span', { class: 'big-emoji' }, '💡'), h('strong', null, 'Brainstorm'), h('small', null, 'Ask a question; every student adds an idea the whole class can see.'))) });
}

async function brainstorm(ctx) {
  const { openTeacherEditor } = await import('./composer.js');
  openTeacherEditor(ctx, 'writing', null, { title: '💡 Brainstorm: ', share: true });
}

/** Play an activity. preview=true for the teacher (checks locally, saves nothing). */
export function openActivityPlayer(ctx, post, { preview = false } = {}) {
  const qs = post.data?.questions || [];
  const answers = qs.map(() => null);
  let i = 0;
  const box = h('div', { class: 'player' });
  const m = modal({ title: `${post.title}${preview ? ' (preview)' : ''}`, size: 'medium', className: 'player-modal', body: box, onClose: () => speechSynthesis?.cancel?.() });

  function draw() {
    clear(box);
    if (i === -1) return;
    if (!qs.length) { add(box, h('p', null, 'This activity has no questions yet.')); return; }
    const qq = qs[i];
    add(box, h('div', { class: 'progress-dots' }, qs.map((_, k) => h('span', { class: `dot ${k === i ? 'now' : answers[k] !== null && answers[k] !== '' ? 'done' : ''}` }))),
      i === 0 && post.body ? h('p', { class: 'instructions' }, post.body) : null,
      h('p', { class: 'muted' }, `Question ${i + 1} of ${qs.length}`));
    if (qq.image) { const img = h('img', { class: 'q-picture', alt: 'Question picture' }); fileUrl(qq.image).then((u) => { if (u) img.src = u; }); add(box, img); }
    if (qq.type !== 'fill') add(box, h('h2', { class: 'q-prompt' }, qq.prompt));
    const area = h('div', { class: 'answer-area' });
    add(box, area);

    if (qq.type === 'mcq') {
      add(area, h('div', { class: 'choice-grid' }, qq.choices.map((c, ci) => h('button', { class: `choice ${answers[i] === ci ? 'on' : ''}`, onclick: () => { answers[i] = ci; draw(); } }, c))));
    } else if (qq.type === 'tf') {
      add(area, h('div', { class: 'choice-grid two' },
        h('button', { class: `choice tf-true ${answers[i] === true ? 'on' : ''}`, onclick: () => { answers[i] = true; draw(); } }, '👍 True'),
        h('button', { class: `choice tf-false ${answers[i] === false ? 'on' : ''}`, onclick: () => { answers[i] = false; draw(); } }, '👎 False')));
    } else if (qq.type === 'fill') {
      const [before, ...rest] = qq.prompt.split(/_{2,}/);
      const inp = h('input', { class: 'input gap-input', autocomplete: 'off', value: answers[i] || '', oninput: (e) => { answers[i] = e.target.value; }, 'aria-label': 'Missing word' });
      add(area, h('h2', { class: 'q-prompt fill' }, before, inp, rest.join(' ___ ')));
      setTimeout(() => inp.focus(), 30);
    } else if (qq.type === 'correct') {
      const ta = h('textarea', { class: 'input input-lg', rows: 2, spellcheck: 'false', oninput: (e) => { answers[i] = e.target.value; } });
      ta.value = answers[i] ?? qq.prompt; answers[i] = ta.value;
      add(area, h('p', { class: 'hint' }, 'Fix the mistakes and write the correct sentence:'), ta);
    } else if (qq.type === 'spell') {
      const inp = h('input', { class: 'input input-xl center', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: answers[i] || '', oninput: (e) => { answers[i] = e.target.value; }, 'aria-label': 'Type the word you hear' });
      add(area, h('button', { class: 'btn btn-speak-big', 'aria-label': 'Listen to the word', onclick: () => speak(qq.say, { rate: 0.75 }) }, '🔊 Listen'),
        h('button', { class: 'btn btn-sm', onclick: () => speak(qq.say, { rate: 0.5 }) }, '🐢 Slower'), inp);
      setTimeout(() => { speak(qq.say, { rate: 0.75 }); inp.focus(); }, 250);
    } else if (qq.type === 'build') {
      const used = answers[i] ? answers[i].__idx || [] : [];
      const line = h('div', { class: 'build-line' }, used.length ? used.map((wi, pos) => h('button', { class: 'tile placed', onclick: () => { used.splice(pos, 1); setBuild(used); } }, qq.words[wi])) : h('span', { class: 'muted' }, 'Tap the words in the right order'));
      const bank = h('div', { class: 'build-bank' }, qq.words.map((w, wi) => used.includes(wi) ? h('span', { class: 'tile ghost' }, w) : h('button', { class: 'tile', onclick: () => { used.push(wi); setBuild(used); } }, w)));
      add(area, line, bank, used.length ? h('button', { class: 'btn btn-sm', onclick: () => setBuild([]) }, '↩️ Start again') : null);
    } else {
      const ta = h('textarea', { class: 'input input-lg', rows: 4, maxlength: 2000, oninput: (e) => { answers[i] = e.target.value; } }); ta.value = answers[i] || '';
      add(area, ta);
    }
    const last = i === qs.length - 1;
    add(box, h('div', { class: 'player-nav' },
      h('button', { class: 'btn', disabled: i === 0, onclick: () => { i--; draw(); } }, '⬅ Back'),
      last ? h('button', { class: 'btn btn-primary btn-lg', onclick: finish }, preview ? '✅ Check (preview)' : '✅ Submit')
        : h('button', { class: 'btn btn-primary btn-lg', onclick: () => { i++; draw(); } }, 'Next ➜')));
  }
  function setBuild(used) {
    const qq = qs[i];
    const s = new String(used.map((wi) => qq.words[wi]).join(' ')); s.__idx = [...used];
    answers[i] = used.length ? s : null; draw();
  }
  const plain = () => answers.map((a) => (a instanceof String ? a.toString() : a));

  async function finish(e) {
    const empty = answers.filter((a) => a === null || a === '').length;
    if (empty && !preview && !confirm(`You have ${empty} question(s) without an answer. Submit anyway?`)) return;
    let result;
    if (preview) {
      result = { ...gradeLocal(qs, ctx.keys[post.id] || [], plain()), keys: ctx.keys[post.id] || [] };
    } else {
      const btn = e.currentTarget; busy(btn, true, 'Checking…');
      try { result = await q(sb.rpc('submit_activity', { p_post: post.id, p_answers: plain() })); }
      catch (er) { toast(errMsg(er), 'error'); busy(btn, false); return; }
      ctx.refresh();
    }
    showResult(result);
  }

  function showResult(r) {
    i = -1; clear(box);
    const pct = r.total ? r.score / r.total : 1;
    add(box, h('div', { class: 'result center' },
      h('div', { class: 'big-emoji bounce' }, pct === 1 ? '🏆' : pct >= 0.7 ? '🌟' : pct >= 0.4 ? '👍' : '💪'),
      h('h2', null, r.total ? `You got ${r.score} out of ${r.total}!` : 'Thank you! Your answers were sent.'),
      h('p', null, pct === 1 ? 'Amazing work!' : pct >= 0.7 ? 'Great job!' : 'Good try! Keep practising.'),
      !preview && r.total < qs.length ? h('p', { class: 'muted' }, 'Your teacher will read your other answers.') : null),
      h('ol', { class: 'result-list' }, qs.map((qq, k) => {
        const ok = r.results[k];
        return h('li', { class: ok === true ? 'ok' : ok === false ? 'bad' : '' },
          h('span', { class: 'res-icon' }, ok === true ? '✅' : ok === false ? '❌' : '📝'),
          h('span', null, qq.type === 'spell' ? `Word ${k + 1}` : qq.prompt, ' — ', h('em', null, displayAns(qq, plain()[k])),
            ok === false && r.keys ? h('span', { class: 'correct-ans' }, ` ✔ ${keyText(qq, r.keys[k])}`) : null));
      })),
      h('div', { class: 'player-nav' }, h('button', { class: 'btn btn-primary', onclick: () => m.close() }, 'Finish')));
  }
  function displayAns(qq, a) {
    if (a === null || a === undefined || a === '') return '(no answer)';
    if (qq.type === 'mcq') return qq.choices[a];
    if (qq.type === 'tf') return a ? 'True' : 'False';
    return String(a);
  }
  draw();
}
