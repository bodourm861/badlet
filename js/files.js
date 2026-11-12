// File checks, uploads to private storage, and temporary (signed) links for viewing.
import { sb, BUCKET, currentUser } from './supa.js';
import { h, uid } from './ui.js';

const MB = 1024 * 1024;
export const TYPES = {
  'image/png': 'image', 'image/jpeg': 'image', 'image/gif': 'image', 'image/webp': 'image',
  'audio/webm': 'audio', 'audio/ogg': 'audio', 'audio/mp4': 'audio', 'audio/mpeg': 'audio', 'audio/wav': 'audio',
  'audio/x-wav': 'audio', 'audio/aac': 'audio', 'audio/x-m4a': 'audio',
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video',
  'application/pdf': 'pdf',
  'application/msword': 'word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-powerpoint': 'powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
};
const EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
  mp4: 'video/mp4', mov: 'video/quicktime', pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export const LIMITS = { image: 10 * MB, audio: 20 * MB, video: 20 * MB, pdf: 20 * MB, word: 20 * MB, powerpoint: 20 * MB };
export const ACCEPT = 'image/*,audio/*,video/mp4,video/webm,video/quicktime,.pdf,.doc,.docx,.ppt,.pptx';

export function checkFile(file, allowed = null) {
  let mime = (file.type || '').split(';')[0].trim().toLowerCase();
  const ext = (file.name || '').split('.').pop().toLowerCase();
  if (!TYPES[mime] && EXT[ext]) mime = EXT[ext];
  const cat = TYPES[mime];
  if (!cat) return { ok: false, error: `“${file.name || 'This file'}” is not an allowed file type.` };
  if (allowed && !allowed.includes(cat)) return { ok: false, error: `Please choose a ${allowed.join(' or ')} file.` };
  if (file.size > LIMITS[cat]) return { ok: false, error: `“${file.name || 'File'}” is too big (max ${LIMITS[cat] / MB} MB).` };
  if (file.size === 0) return { ok: false, error: 'That file is empty.' };
  return { ok: true, mime, cat };
}

function safeName(name) {
  return (name || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-60) || 'file';
}

// teacher=true → t/<uid>/...  (teacher materials, reusable across boards)
// otherwise   → b/<board>/<uid>/...
export async function uploadFile(file, { boardId, teacher = false, name } = {}) {
  const chk = checkFile(file);
  if (!chk.ok) throw new Error(chk.error);
  const user = await currentUser();
  if (!user) throw new Error('Please sign in again');
  const fname = safeName(name || file.name || `${chk.cat}.${Object.keys(EXT).find((k) => EXT[k] === chk.mime) || 'bin'}`);
  const path = teacher ? `t/${user.id}/${uid()}-${fname}` : `b/${boardId}/${user.id}/${uid()}-${fname}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: chk.mime, upsert: false, cacheControl: '3600' });
  if (error) throw error;
  return { path, name: name || file.name || fname, type: chk.mime, size: file.size };
}

export async function removeFiles(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  try { await sb.storage.from(BUCKET).remove(list); } catch (e) { console.warn('remove failed', e); }
}

// Signed links are batched and cached for ~50 minutes.
const cache = new Map();
let pending = new Map();
let timer = null;
export function fileUrl(path) {
  const c = cache.get(path);
  if (c && c.exp > Date.now()) return Promise.resolve(c.url);
  if (pending.has(path)) return pending.get(path).promise;
  let resolve; const promise = new Promise((r) => { resolve = r; });
  pending.set(path, { promise, resolve });
  clearTimeout(timer);
  timer = setTimeout(flush, 15);
  return promise;
}
async function flush() {
  const batch = pending; pending = new Map();
  const paths = [...batch.keys()];
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    try {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(chunk, 3600);
      if (error) throw error;
      (data || []).forEach((d) => {
        const url = d.signedUrl || null;
        if (url) cache.set(d.path, { url, exp: Date.now() + 50 * 60 * 1000 });
        batch.get(d.path)?.resolve(url);
      });
    } catch (e) {
      console.warn('signed url failed', e);
    }
    chunk.forEach((p) => batch.get(p)?.resolve(cache.get(p)?.url || null));
  }
}

const FILE_ICONS = { pdf: '📕', word: '📘', powerpoint: '📙', image: '🖼️', audio: '🎵', video: '🎬' };

// Renders one attachment (image / audio / video / document link)
export function renderAttachment(att, { compact = false } = {}) {
  const cat = TYPES[att.type] || 'file';
  if (cat === 'image') {
    const img = h('img', { class: 'att-img', alt: att.name || 'picture', loading: 'lazy' });
    fileUrl(att.path).then((u) => { if (u) img.src = u; else img.alt = 'Picture unavailable'; });
    img.addEventListener('click', () => { if (img.src) window.open(img.src, '_blank', 'noopener'); });
    return img;
  }
  if (cat === 'audio') {
    const au = h('audio', { controls: true, preload: 'none', class: 'att-audio' });
    fileUrl(att.path).then((u) => { if (u) au.src = u; });
    return h('div', { class: 'att-audio-wrap' }, h('span', { class: 'att-label' }, '🎧 ', att.label || (att.name && !/^recording/i.test(att.name) ? att.name : 'Voice recording')), au);
  }
  if (cat === 'video') {
    const v = h('video', { controls: true, preload: 'metadata', class: 'att-video', playsinline: true });
    fileUrl(att.path).then((u) => { if (u) v.src = u; });
    return v;
  }
  const a = h('a', { class: 'att-file', target: '_blank', rel: 'noopener', href: '#' },
    h('span', { class: 'att-file-icon' }, FILE_ICONS[cat] || '📎'),
    h('span', { class: 'att-file-name' }, att.name || 'File'),
    compact ? null : h('span', { class: 'att-file-size' }, att.size ? `${Math.max(1, Math.round(att.size / 1024))} KB` : ''));
  a.addEventListener('click', async (e) => {
    e.preventDefault();
    const u = await fileUrl(att.path);
    if (u) window.open(u, '_blank', 'noopener');
  });
  return a;
}

export function attachmentPaths(posts) {
  const out = [];
  (posts || []).forEach((p) => (p.attachments || []).forEach((a) => a.path && out.push(a.path)));
  return out;
}

export function fileCat(att) { return TYPES[att?.type] || 'file'; }
