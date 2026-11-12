// Home page, teacher sign-in, student join page, and "setup needed" screen.
import { sb, q, currentUser, isTeacherUser } from '../supa.js';
import { h, add, clear, toast, errMsg, busy, field } from '../ui.js';
import { APP_NAME } from '../config.js';
import { renderBoard } from './board.js';

export function renderSetupNeeded(app) {
  app.appendChild(h('div', { class: 'center-card wide' },
    h('div', { class: 'big-emoji' }, '🛠️'),
    h('h1', null, `${APP_NAME} is almost ready`),
    h('p', null, 'The website is not connected to its database yet.'),
    h('ol', { class: 'steps' },
      h('li', null, 'Create a free Supabase project and run supabase/schema.sql (see README.md).'),
      h('li', null, 'Open js/config.js and paste your Project URL and anon/publishable key.'),
      h('li', null, 'Upload the website again and refresh this page.'))));
}

function illustration() {
  return h('div', { class: 'hero-art', 'aria-hidden': 'true' },
    h('span', { class: 'float f1' }, '📚'), h('span', { class: 'float f2' }, '✏️'), h('span', { class: 'float f3' }, '🎤'),
    h('span', { class: 'float f4' }, '🌈'), h('span', { class: 'float f5' }, '⭐'), h('span', { class: 'float f6' }, '🔤'));
}

export async function renderHome(app) {
  const user = await currentUser();
  const codeInput = h('input', { class: 'input input-lg', placeholder: 'Paste your board link here', 'aria-label': 'Board link' });
  const goBoard = () => {
    const v = codeInput.value.trim();
    const m = v.match(/#\/b\/([\w-]+)/) || v.match(/^([\w-]{6,})$/);
    if (!m) { toast('Please paste the link your teacher sent you', 'error'); return; }
    location.hash = `#/b/${m[1]}`;
  };
  app.appendChild(h('div', { class: 'home' },
    h('header', { class: 'home-hero' },
      illustration(),
      h('h1', { class: 'logo-big' }, h('span', null, '🧸'), ` ${APP_NAME}`),
      h('p', { class: 'tagline' }, 'A happy place to share, read, speak and learn English together.')),
    h('div', { class: 'home-cards' },
      h('section', { class: 'home-card student' },
        h('div', { class: 'big-emoji' }, '🎒'),
        h('h2', null, 'I am a student'),
        h('p', null, 'Open the link from your teacher in Teams. Or paste it here:'),
        codeInput,
        h('button', { class: 'btn btn-primary btn-lg', onclick: goBoard }, 'Go to my board ➜')),
      h('section', { class: 'home-card teacher' },
        h('div', { class: 'big-emoji' }, '🍎'),
        h('h2', null, 'I am a teacher'),
        h('p', null, 'Create boards, share them with your class, and see every answer.'),
        isTeacherUser(user)
          ? h('a', { class: 'btn btn-primary btn-lg', href: '#/dashboard' }, 'Open my dashboard ➜')
          : h('a', { class: 'btn btn-secondary btn-lg', href: '#/teacher' }, 'Teacher sign in ➜')))));
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goBoard(); });
}

export async function renderTeacherAuth(app) {
  const user = await currentUser();
  if (isTeacherUser(user)) { location.hash = '#/dashboard'; return; }
  let mode = 'signin';
  const wrap = h('div', { class: 'center-card' });
  app.appendChild(h('div', { class: 'auth-page' }, wrap));

  function draw() {
    clear(wrap);
    const name = h('input', { class: 'input', autocomplete: 'name', placeholder: 'e.g. Ms Sarah' });
    const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true });
    const pw = h('input', { class: 'input', type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', minlength: 8, required: true });
    const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, mode === 'signin' ? 'Sign in' : 'Create teacher account');
    const form = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      if (!email.value || pw.value.length < 8) { toast('Enter your email and a password of 8+ characters', 'error'); return; }
      busy(btn, true);
      try {
        if (mode === 'signin') {
          await q(sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value }));
          location.hash = '#/dashboard';
        } else {
          const data = await q(sb.auth.signUp({ email: email.value.trim(), password: pw.value,
            options: { data: { display_name: name.value.trim() || 'Teacher' }, emailRedirectTo: location.origin + location.pathname } }));
          if (data.session) location.hash = '#/dashboard';
          else { clear(wrap).appendChild(h('div', { class: 'stack center' }, h('div', { class: 'big-emoji' }, '📬'), h('h2', null, 'Check your email'),
            h('p', null, `We sent a confirmation link to ${email.value}. Click it, then come back and sign in.`),
            h('button', { class: 'btn', onclick: () => { mode = 'signin'; draw(); } }, 'Back to sign in'))); }
        }
      } catch (err) {
        let m = errMsg(err);
        if (/Invalid login/i.test(m)) m = 'Email or password is not correct.';
        if (/Email not confirmed/i.test(m)) m = 'Please click the link in your confirmation email first.';
        toast(m, 'error');
      } finally { busy(btn, false); }
    } },
      mode === 'signup' ? field('Your name (shown on your posts)', name) : null,
      field('Email', email),
      field('Password', pw, mode === 'signup' ? 'At least 8 characters' : null),
      btn);
    add(wrap, 
      h('div', { class: 'big-emoji' }, '🍎'),
      h('h1', null, mode === 'signin' ? 'Teacher sign in' : 'Create a teacher account'),
      form,
      h('div', { class: 'auth-links' },
        mode === 'signin'
          ? h('button', { class: 'link', onclick: () => { mode = 'signup'; draw(); } }, 'New here? Create a teacher account')
          : h('button', { class: 'link', onclick: () => { mode = 'signin'; draw(); } }, 'I already have an account'),
        mode === 'signin' ? h('button', { class: 'link', onclick: async () => {
          if (!email.value) { toast('Type your email first', 'error'); email.focus(); return; }
          const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
          toast(error ? errMsg(error) : 'Password reset email sent 📬', error ? 'error' : 'ok');
        } }, 'Forgot password?') : null),
      h('p', { class: 'muted small' }, 'Students do not need an account. They join with the board link.'),
      h('a', { class: 'link', href: '#/' }, '← Back'));
  }
  draw();
}

export async function renderJoin(app, slug) {
  const preview = await q(sb.rpc('board_preview', { p_slug: slug }));
  if (!preview) {
    app.appendChild(h('div', { class: 'center-card' }, h('div', { class: 'big-emoji' }, '🔍'), h('h1', null, 'Board not found'),
      h('p', null, 'Please check the link with your teacher.'), h('a', { class: 'btn', href: '#/' }, 'Home')));
    return;
  }
  const user = await currentUser();
  if (user) {
    const owned = isTeacherUser(user) ? await q(sb.from('boards').select('id').eq('id', preview.id).eq('owner_id', user.id)) : [];
    if (owned.length) { location.hash = `#/t/${preview.id}`; return; }
    const mem = await q(sb.from('board_members').select('display_name').eq('board_id', preview.id).eq('user_id', user.id));
    if (mem.length) return renderBoard(app, { boardId: preview.id, asTeacher: false, slug });
  }
  if (preview.status !== 'active') {
    app.appendChild(h('div', { class: 'center-card' }, h('div', { class: 'big-emoji' }, '🔒'), h('h1', null, preview.title),
      h('p', null, 'This board is closed now.')));
    return;
  }

  let inner = null;
  const savedName = localStorage.getItem('cb_name') || '';
  const name = h('input', { class: 'input input-xl', autocomplete: 'given-name', maxlength: 40, value: savedName, placeholder: 'My first name' });
  const klass = h('input', { class: 'input input-xl', maxlength: 30, value: localStorage.getItem('cb_class') || preview.class_name || '', placeholder: 'e.g. 4A' });
  const code = preview.needs_code ? h('input', { class: 'input input-xl code-input', maxlength: 20, autocomplete: 'off', placeholder: 'Code' }) : null;
  const btn = h('button', { class: 'btn btn-primary btn-xl', type: 'submit' }, "Let's go! 🚀");
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    if (!name.value.trim()) { toast('Please type your first name', 'error'); name.focus(); return; }
    busy(btn, true, 'Joining…');
    try {
      let u = await currentUser();
      if (!u) {
        const { error } = await sb.auth.signInAnonymously();
        if (error) {
          if (/anonymous/i.test(error.message)) throw new Error('Joining is not switched on yet. Ask your teacher to enable “anonymous sign-ins” in Supabase.');
          if (/rate limit|too many/i.test(error.message)) throw new Error('Too many classmates joined at once. Wait one minute and try again.');
          throw error;
        }
      }
      await q(sb.rpc('join_board', { p_slug: slug, p_code: code ? code.value : '', p_name: name.value, p_class: klass.value }));
      localStorage.setItem('cb_name', name.value.trim());
      localStorage.setItem('cb_class', klass.value.trim());
      clear(app);
      inner = await renderBoard(app, { boardId: preview.id, asTeacher: false, slug });
    } catch (err) { toast(errMsg(err), 'error'); busy(btn, false); }
  } },
    field('👋 What is your first name?', name),
    field('🏫 Your class', klass),
    code ? field('🔑 Class code from your teacher', code) : null,
    btn);
  app.appendChild(h('div', { class: `join-page theme-${preview.theme || 'sky'}` },
    h('div', { class: 'center-card join-card' },
      illustration(),
      h('p', { class: 'join-kicker' }, preview.subject || 'English'),
      h('h1', null, preview.title),
      preview.description ? h('p', { class: 'join-desc' }, preview.description) : null,
      form,
      h('p', { class: 'muted small' }, 'Only your first name is shown. Do not type your surname or any secret information.'))));
  return () => { if (inner) inner(); };
}
