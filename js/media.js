// Audio recorder (MediaRecorder API), drawing pad, and free text-to-speech.
import { h, clear, toast } from './ui.js';

export function recordingSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const m of opts) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* */ } }
  return '';
}

/**
 * Recorder widget.  Buttons: Start → Stop → Play / Re-record / (Submit)
 * options.onSubmit(blob) shows a "Submit recording" button.
 * options.onChange(blob|null) is called whenever a recording is ready / cleared.
 */
export function createRecorder({ maxSeconds = 180, onSubmit = null, submitLabel = '✅ Submit recording', onChange = null, prompt = '' } = {}) {
  const root = h('div', { class: 'recorder' });
  let stream = null, rec = null, chunks = [], blob = null, url = null, t0 = 0, tick = null, mime = '';

  const stopStream = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
  const setBlob = (b) => {
    blob = b;
    if (url) URL.revokeObjectURL(url);
    url = b ? URL.createObjectURL(b) : null;
    onChange && onChange(b);
  };

  function view(state, extra) {
    clear(root);
    if (prompt) root.appendChild(h('p', { class: 'rec-prompt' }, prompt));
    if (!recordingSupported()) {
      root.appendChild(h('p', { class: 'notice' }, '🎤 This browser cannot record sound. Try Chrome, Edge or Safari, or open the link in your browser instead of inside Teams.'));
      return;
    }
    if (state === 'idle') {
      root.appendChild(h('button', { type: 'button', class: 'btn btn-rec', onclick: start }, '🎤 Start recording'));
      root.appendChild(h('p', { class: 'hint' }, `You can record up to ${Math.round(maxSeconds / 60)} minutes.`));
    } else if (state === 'recording') {
      const time = h('span', { class: 'rec-time' }, '0:00');
      root.appendChild(h('div', { class: 'rec-live' }, h('span', { class: 'rec-dot' }), 'Recording… ', time));
      root.appendChild(h('button', { type: 'button', class: 'btn btn-stop', onclick: stop }, '⏹ Stop recording'));
      tick = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        if (s >= maxSeconds) stop();
      }, 250);
    } else if (state === 'done') {
      const audio = h('audio', { controls: true, src: url, class: 'rec-audio' });
      root.appendChild(h('div', { class: 'rec-done' },
        h('p', { class: 'rec-ok' }, '✅ Recording ready. Listen to it:'),
        audio,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn', onclick: () => { audio.currentTime = 0; audio.play(); } }, '▶️ Play recording'),
          h('button', { type: 'button', class: 'btn', onclick: () => { setBlob(null); view('idle'); } }, '🔁 Re-record'),
          onSubmit ? h('button', { type: 'button', class: 'btn btn-primary', onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true; b.textContent = 'Sending…';
            try { await onSubmit(blob); } finally { if (b.isConnected) { b.disabled = false; b.textContent = submitLabel; } }
          } }, submitLabel) : null)));
    } else if (state === 'error') {
      root.appendChild(h('p', { class: 'notice' }, extra));
      root.appendChild(h('button', { type: 'button', class: 'btn', onclick: () => view('idle') }, 'Try again'));
    }
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const msg = e && e.name === 'NotAllowedError'
        ? '🎤 The microphone is blocked. Click the lock 🔒 next to the web address and allow the microphone, then try again.'
        : '🎤 No microphone found. Check that a microphone is connected.';
      view('error', msg); return;
    }
    mime = pickMime();
    chunks = [];
    try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch { rec = new MediaRecorder(stream); }
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      clearInterval(tick); stopStream();
      const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
      const b = new Blob(chunks, { type });
      if (b.size < 200) { view('error', 'The recording was empty. Please try again.'); return; }
      setBlob(b); view('done');
    };
    rec.start(1000);
    t0 = Date.now();
    view('recording');
  }
  function stop() { clearInterval(tick); if (rec && rec.state !== 'inactive') rec.stop(); }

  view('idle');
  return {
    el: root,
    getBlob: () => blob,
    reset: () => { setBlob(null); view('idle'); },
    destroy: () => { clearInterval(tick); try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* */ } stopStream(); },
  };
}

export function blobToFile(blob, base = 'recording') {
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('png') ? 'png' : 'webm';
  try { return new File([blob], `${base}.${ext}`, { type: blob.type }); }
  catch { blob.name = `${base}.${ext}`; return blob; }
}

/** Drawing pad for drawings and handwritten answers. */
export function createDrawpad({ width = 640, height = 420 } = {}) {
  const canvas = h('canvas', { class: 'drawpad-canvas', width, height, 'aria-label': 'Drawing area' });
  const ctx = canvas.getContext('2d');
  const reset = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); };
  reset();
  let color = '#1f2a44', size = 5, erasing = false, drawing = false, last = null, empty = true;
  const history = [];
  const snap = () => { history.push(ctx.getImageData(0, 0, width, height)); if (history.length > 25) history.shift(); };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (width / r.width), y: (e.clientY - r.top) * (height / r.height) }; };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); snap(); drawing = true; last = pos(e); dot(last); });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); line(last, p); last = p; });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  function stroke() { ctx.strokeStyle = erasing ? '#ffffff' : color; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = erasing ? size * 4 : size; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
  function dot(p) { stroke(); ctx.beginPath(); ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); empty = false; }
  function line(a, b) { stroke(); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); empty = false; }

  const colors = ['#1f2a44', '#e63946', '#2a9d8f', '#457b9d', '#f4a261', '#9b5de5', '#43aa8b'];
  const swatches = colors.map((c) => h('button', { type: 'button', class: 'swatch', style: { background: c }, 'aria-label': `Colour ${c}`,
    onclick: (e) => { color = c; erasing = false; mark(e.currentTarget); } }));
  function mark(btn) { tools.querySelectorAll('.swatch,.tool').forEach((b) => b.classList.remove('on')); btn.classList.add('on'); }
  const tools = h('div', { class: 'drawpad-tools' },
    swatches,
    h('button', { type: 'button', class: 'tool', onclick: (e) => { erasing = true; mark(e.currentTarget); } }, '🧽 Eraser'),
    h('select', { class: 'input input-sm', 'aria-label': 'Pen size', onchange: (e) => { size = +e.target.value; } },
      h('option', { value: 3 }, 'Thin'), h('option', { value: 5, selected: true }, 'Medium'), h('option', { value: 10 }, 'Thick')),
    h('button', { type: 'button', class: 'tool', onclick: () => { if (history.length) ctx.putImageData(history.pop(), 0, 0); } }, '↩️ Undo'),
    h('button', { type: 'button', class: 'tool', onclick: () => { snap(); reset(); empty = true; } }, '🗑️ Clear'));
  swatches[0].classList.add('on');
  return {
    el: h('div', { class: 'drawpad' }, tools, canvas),
    isEmpty: () => empty,
    toBlob: () => new Promise((r) => canvas.toBlob((b) => r(b), 'image/png')),
  };
}

/** Free text-to-speech using the browser's built-in voices. */
let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices(); } catch { voices = []; } }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
export function speak(text, { rate = 0.85 } = {}) {
  if (!('speechSynthesis' in window)) { toast('This browser cannot read aloud.', 'error'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text || ''));
  const pref = localStorage.getItem('cb_voice_lang') || 'en-GB';
  const v = voices.find((x) => x.lang === pref) || voices.find((x) => x.lang && x.lang.startsWith('en'));
  if (v) u.voice = v;
  u.lang = v ? v.lang : 'en-GB';
  u.rate = rate;
  speechSynthesis.speak(u);
}
export function speakButton(text, label = '🔊', title = 'Listen') {
  return h('button', { type: 'button', class: 'btn-speak', title, 'aria-label': `${title}: ${text}`, onclick: (e) => { e.stopPropagation(); speak(text); } }, label);
}
