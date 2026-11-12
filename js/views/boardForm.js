// Create / edit board form, share dialog, and delete helper (teacher only).
import { sb, q, currentUser } from '../supa.js';
import { h, add, modal, toast, errMsg, busy, field, toggle, confirmBox, copyText, LAYOUTS, THEMES } from '../ui.js';
import { uploadFile, checkFile, removeFiles, fileUrl } from '../files.js';

export const FEATURES = [
  ['require_approval', 'Approve posts before others see them', 'New student posts wait for you'],
  ['allow_posts', 'Students can add their own posts', 'Turn off if students should only answer your tasks'],
  ['allow_comments', 'Comments', 'Students can comment on posts'],
  ['allow_peer_feedback', 'Peer feedback', '“I like… / Next time…” feedback on classmates’ work'],
  ['allow_likes', 'Likes ❤️', null],
  ['allow_stars', 'Star ratings ⭐', null],
  ['allow_votes', 'Voting 👍', null],
  ['allow_edit_own', 'Students can edit / delete their own posts', null],
  ['allow_uploads', 'Students can upload pictures and files', null],
  ['allow_audio', 'Students can record audio', null],
  ['show_names', 'Show classmates’ names', 'If off, students see “Classmate” on other students’ posts'],
  ['show_leaderboard', 'Show class leaderboard to students', 'Off = each student sees only their own progress'],
];
export const DEFAULTS = { require_approval: false, allow_posts: true, allow_comments: true, allow_likes: true, allow_stars: false,
  allow_votes: false, allow_peer_feedback: false, allow_edit_own: true, allow_uploads: true, allow_audio: true,
  posting_locked: false, show_names: true, show_leaderboard: false };
export const setting = (board, k) => (board.settings && k in board.settings ? !!board.settings[k] : !!DEFAULTS[k]);

export function studentLink(board) { return `${location.origin}${location.pathname}#/b/${board.slug}`; }

export function randomCode() {
  const words = ['CAT', 'SUN', 'BEE', 'OWL', 'FOX', 'STAR', 'MOON', 'TREE', 'FISH', 'BOOK'];
  return words[Math.floor(Math.random() * words.length)] + Math.floor(10 + Math.random() * 90);
}

export async function openBoardForm(existing, { onSaved, onDeleted } = {}) {
  const b = existing || { title: '', description: '', subject: 'English', class_name: '', unit: '', lesson: '', layout: 'wall', theme: 'sky', settings: { ...DEFAULTS } };
  const settings = { ...DEFAULTS, ...(b.settings || {}) };
  let secret = { access_code: '' };
  if (existing) {
    const rows = await q(sb.from('board_secrets').select('*').eq('board_id', existing.id));
    if (rows[0]) secret = rows[0];
  }
  const title = h('input', { class: 'input', maxlength: 120, value: b.title, placeholder: 'e.g. Unit 3 – Animals vocabulary' });
  const desc = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: 'What will students do on this board?' }); desc.value = b.description || '';
  const subject = h('input', { class: 'input', maxlength: 60, value: b.subject || 'English' });
  const klass = h('input', { class: 'input', maxlength: 60, value: b.class_name || '', placeholder: 'e.g. 4A' });
  const unit = h('input', { class: 'input', maxlength: 80, value: b.unit || '', placeholder: 'e.g. Unit 3' });
  const lesson = h('input', { class: 'input', maxlength: 80, value: b.lesson || '', placeholder: 'e.g. Lesson 2' });
  const layout = h('select', { class: 'input' }, Object.entries(LAYOUTS).map(([k, v]) => h('option', { value: k, selected: k === b.layout }, `${v.icon} ${v.label}`)));
  const theme = h('select', { class: 'input' }, Object.entries(THEMES).map(([k, v]) => h('option', { value: k, selected: k === b.theme }, v)));
  const code = h('input', { class: 'input code-input', maxlength: 20, value: secret.access_code || '', placeholder: 'No code' });
  const coverInput = h('input', { type: 'file', accept: 'image/*', class: 'input' });
  let coverPath = b.cover_path || null;
  const coverPreview = h('div', { class: 'cover-preview' });
  const showCover = async () => {
    coverPreview.textContent = '';
    if (coverPath) {
      const u = await fileUrl(coverPath);
      add(coverPreview, h('img', { src: u || '', alt: 'Cover' }), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { coverPath = null; showCover(); } }, 'Remove cover'));
    }
  };
  showCover();
  const toggles = FEATURES.map(([k, label, hint]) => toggle(label, settings[k], (v) => { settings[k] = v; }, hint));

  const save = h('button', { class: 'btn btn-primary', onclick: async () => {
    if (!title.value.trim()) { toast('Please give the board a title', 'error'); title.focus(); return; }
    busy(save, true, 'Saving…');
    try {
      if (coverInput.files[0]) {
        const c = checkFile(coverInput.files[0], ['image']);
        if (!c.ok) throw new Error(c.error);
        coverPath = (await uploadFile(coverInput.files[0], { teacher: true })).path;
      }
      const row = { title: title.value.trim(), description: desc.value.trim(), subject: subject.value.trim(), class_name: klass.value.trim(),
        unit: unit.value.trim(), lesson: lesson.value.trim(), layout: layout.value, theme: theme.value, cover_path: coverPath,
        settings: { ...(b.settings || {}), ...settings } };
      let saved;
      if (existing) saved = (await q(sb.from('boards').update(row).eq('id', existing.id).select()))[0];
      else saved = (await q(sb.from('boards').insert(row).select()))[0];
      await q(sb.from('board_secrets').update({ access_code: code.value.trim().toUpperCase() || null }).eq('board_id', saved.id));
      toast(existing ? 'Board saved ✅' : 'Board created 🎉', 'ok');
      m.close();
      onSaved && onSaved(saved);
    } catch (e) { toast(errMsg(e), 'error'); busy(save, false); }
  } }, existing ? 'Save changes' : 'Create board');

  const body = h('div', { class: 'form-grid' },
    h('section', null,
      h('h3', null, '📋 About this board'),
      field('Title', title), field('Description', desc),
      h('div', { class: 'grid-2' }, field('Subject', subject), field('Class', klass), field('Unit', unit), field('Lesson', lesson)),
      h('div', { class: 'grid-2' }, field('Layout', layout, 'You can change this any time — nothing is lost.'), field('Colour theme', theme)),
      field('Cover picture (optional)', coverInput), coverPreview),
    h('section', null,
      h('h3', null, '🔑 Access'),
      field('Class code (optional)', h('div', { class: 'row' }, code, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { code.value = randomCode(); } }, '🎲 Make one'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { code.value = ''; } }, 'No code')),
        'Students type this code once when they join. Leave empty to let anyone with the link join.'),
      h('h3', null, '⚙️ Features'),
      h('div', { class: 'toggles' }, toggles),
      existing ? h('div', { class: 'danger-zone' },
        h('h3', null, 'Danger zone'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => { if (await deleteBoard(existing)) { m.close(); onDeleted && onDeleted(); } } }, '🗑️ Delete this board')) : null));

  const m = modal({ title: existing ? 'Board settings' : 'New board', size: 'large', body,
    actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), save] });
}

export async function deleteBoard(board) {
  const ok = await confirmBox(`Delete “${board.title}” and ALL student work on it? This cannot be undone.`, { okText: 'Delete forever', danger: true, typeToConfirm: 'DELETE' });
  if (!ok) return false;
  try {
    const posts = await q(sb.from('posts').select('attachments').eq('board_id', board.id));
    const paths = [];
    posts.forEach((p) => (p.attachments || []).forEach((a) => { if (a.path && a.path.startsWith('b/')) paths.push(a.path); }));
    for (let i = 0; i < paths.length; i += 100) await removeFiles(paths.slice(i, i + 100));
    await q(sb.from('boards').delete().eq('id', board.id));
    toast('Board deleted', 'ok');
    return true;
  } catch (e) { toast(errMsg(e), 'error'); return false; }
}

export async function openShare(board) {
  const rows = await q(sb.from('board_secrets').select('access_code').eq('board_id', board.id));
  const code = rows[0]?.access_code;
  const link = studentLink(board);
  const linkInput = h('input', { class: 'input', readonly: true, value: link, onclick: (e) => e.target.select() });
  const teamsMsg = `📌 ${board.title}\nOpen this link and type your first name:\n${link}${code ? `\nClass code: ${code}` : ''}`;
  modal({ title: '📤 Share with students', size: 'medium', body: h('div', { class: 'stack' },
    field('Student link', h('div', { class: 'row' }, linkInput,
      h('button', { class: 'btn btn-primary', onclick: async () => toast(await copyText(link) ? 'Link copied ✅' : 'Copy failed — select the link and copy it', 'ok') }, '📋 Copy link'))),
    code ? h('p', { class: 'code-show' }, 'Class code: ', h('strong', null, code)) : h('p', { class: 'muted' }, 'No class code — anyone with the link can join.'),
    board.status !== 'active' ? h('p', { class: 'notice' }, '⚠️ This board is archived. Students cannot join until you restore it.') : null,
    h('div', { class: 'teams-box' },
      h('h3', null, 'Send it in Microsoft Teams'),
      h('ol', null,
        h('li', null, 'Click “Copy Teams message” below.'),
        h('li', null, 'In Teams, open your class team → the channel or chat → paste → Send.'),
        h('li', null, 'Students click the link, type their first name, and start.')),
      h('pre', { class: 'teams-msg' }, teamsMsg),
      h('button', { class: 'btn', onclick: async () => toast(await copyText(teamsMsg) ? 'Message copied ✅' : 'Copy failed', 'ok') }, '📋 Copy Teams message'),
      h('p', { class: 'hint' }, 'Tip: for recording, students should open the link in their web browser (Teams may ask “Open in browser”).'))) });
}
