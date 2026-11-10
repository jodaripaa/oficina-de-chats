'use strict';
/* Oficina de chats — Avisos con campanita.
   Entre un refresco y otro detecta cuándo un hilo pasa a «te espera», completa su lista o termina un turno, y entonces:
   suena una campanita (WebAudio, sin archivos), su trabajador salta con la mano arriba, sale un toast,
   una notificación de Windows si la activaste, y el título de la ventana muestra cuántos te esperan.
   En la primera carga no avisa: solo cambios nuevos. Usa las piezas de game.js (world, XMAS, toast, goToThread…). */

const AVISO_MS = 6500;                         // cuánto salta el trabajador
const AVISO_RANK = { espera: 3, lista: 2, turno: 1 };
const LS_MUTE = 'oficina-avisos-silencio';
const LS_NOTIF = 'oficina-avisos-sistema';

let avisosMuted = false;
let avisosNotif = false;
try { avisosMuted = localStorage.getItem(LS_MUTE) === '1'; avisosNotif = localStorage.getItem(LS_NOTIF) === '1'; } catch {}

let avisoPrev = null;            // id -> foto del hilo en el refresco anterior
const avisoAnim = new Map();     // id -> { start, kind }
const avisoFired = new Map();    // id -> última clave avisada (para no repetir)

/* ---- Lo que dibuja game.js: salto y mano arriba ---- */
function avisoFx(id, now) {
  const f = avisoAnim.get(id);
  if (!f) return null;
  const k = now - f.start;
  if (k > AVISO_MS || k < -1000) { avisoAnim.delete(id); return null; }
  return { hop: Math.round(Math.abs(Math.sin(k / 150)) * 4), both: f.kind === 'lista', kind: f.kind };
}

/* ---- Detección ---- */
function avisoSnap(data) {
  const m = new Map();
  for (const p of data.projects) for (const t of p.threads) {
    m.set(t.id, { status: t.status, ask: t.ask || null, done: t.done, total: t.total, recap: t.recap || null });
  }
  return m;
}

function avisoDetect(prev, now, data) {
  const events = [];
  for (const [id, n] of now) {
    const p = prev.get(id);
    let kind = null;
    if (n.status === 'espera' && n.ask && (!p || p.status !== 'espera' || p.ask !== n.ask)) kind = 'espera';
    else if (!p) continue;
    else if (n.total > 0 && n.done === n.total && !(p.total > 0 && p.done === p.total)) kind = 'lista';
    else if (n.recap && n.recap !== p.recap) kind = 'turno';
    // Con datos en vivo, «dejó de trabajar» también es fin de turno (sin datos en vivo es solo una estimación por la hora).
    else if (data.isLive && p.status === 'trabajando' && n.status !== 'trabajando' && n.status !== 'espera') kind = 'turno';
    if (!kind) continue;
    // El mismo aviso no se repite seguido (p. ej. el resumen nuevo y, segundos después, «dejó de trabajar»)
    const key = `${kind === 'espera' ? 'espera' : 'fin'}|${n.ask}|${n.recap}`;
    const last = avisoFired.get(id);
    if (last && last.key === key && Date.now() - last.at < 120e3) continue;
    avisoFired.set(id, { key, at: Date.now() });
    const t = threadById.get(id);
    if (t) events.push({ id, kind, t });
  }
  return events;
}

addEventListener('oficina:mundo', ev => avisoOnWorld(ev.detail));

function avisoOnWorld(data) {
  const now = avisoSnap(data);
  if (avisoPrev) {
    const events = avisoDetect(avisoPrev, now, data);
    if (events.length) avisoFire(events);
  }
  avisoPrev = now;
  avisoTitle();
  placeToasts();
}

/* ---- Lo que pasa cuando hay aviso ---- */
function avisoText(e) {
  const name = `«${cut(e.t.title, 34)}»`;
  if (e.kind === 'espera') return { head: `🔔 ${name} te espera`, body: cut(e.t.ask || '', 120) };
  if (e.kind === 'lista') return { head: `${XMAS ? '🎁' : '🎉'} ${name} completó su lista (${e.t.done}/${e.t.total})`, body: cut(e.t.recap || '', 120) };
  return { head: `✅ ${name} terminó su turno`, body: cut(e.t.recap || '', 120) };
}

function avisoOpen(e) {
  if (e.kind === 'espera') openReception();
  else goToThread(e.id);
}

function avisoFire(events) {
  events.sort((a, b) => AVISO_RANK[b.kind] - AVISO_RANK[a.kind]);
  const start = performance.now();
  for (const e of events) avisoAnim.set(e.id, { start, kind: e.kind });
  chime(events[0].kind);
  events.slice(0, 3).forEach(avisoToast);
  if (events.length > 3) toast(`…y ${events.length - 3} avisos más. Mira la recepción 🛎️`, 'info', 7000);
  avisoSystem(events);
}

function avisoToast(e) {
  const { head, body } = avisoText(e);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `toast aviso aviso-${e.kind}`;
  el.innerHTML = `<b>${esc(head)}</b>${body ? `<span>${esc(body)}</span>` : ''}<i>${e.kind === 'espera' ? 'responder ›' : 'ver ›'}</i>`;
  el.addEventListener('click', () => { el.remove(); avisoOpen(e); });
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 10000);
  while ($('#toasts').children.length > 5) $('#toasts').firstElementChild.remove();
}

function avisoIcon(t) {
  try {
    const big = document.createElement('canvas');
    big.width = big.height = 64;
    const g = big.getContext('2d');
    g.fillStyle = XMAS ? '#12352a' : '#241f3d';
    g.fillRect(0, 0, 64, 64);
    g.imageSmoothingEnabled = false;
    g.drawImage(avatarCanvas(t), 0, 0, 64, 64);
    return big.toDataURL('image/png');
  } catch { return undefined; }
}

function avisoSystem(events, force) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!force && (avisosMuted || !avisosNotif)) return;
  if (!force && document.hasFocus() && !document.hidden) return; // si estás mirando la oficina, basta con el toast
  const e = events[0];
  const { head, body } = avisoText(e);
  try {
    const n = new Notification(events.length > 1 ? `Oficina: ${events.length} avisos` : head.replace(/^\S+\s/, ''), {
      body: events.length > 1 ? events.map(x => avisoText(x).head).join('\n') : body,
      icon: avisoIcon(e.t),
      tag: 'oficina-aviso',
      silent: Boolean(audioCtx && audioCtx.state === 'running'), // ya suena la campanita
    });
    n.onclick = () => { window.focus(); n.close(); avisoOpen(e); };
  } catch { /* algunos navegadores no dejan crearla aquí */ }
}

/* ---- Contador en el título: «(3) Oficina de chats» ---- */
function avisoTitle() {
  const base = XMAS ? 'Oficina navideña' : 'Oficina de chats';
  const n = world ? allThreads().filter(t => t.status === 'espera').length : 0;
  const want = n ? `(${n}) ${base}` : base;
  if (document.title !== want) document.title = want;
}

/* ---- La campanita (WebAudio, sin archivos) ---- */
let audioCtx = null;
let noiseBuf = null;

function audio() {
  // Sin un clic o tecla previa el navegador no deja sonar: ni lo intentamos (así no hay advertencias).
  if (!audioCtx) {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
addEventListener('pointerdown', () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {}); }, true);

/** Timbre de recepción: un golpe metálico con parciales inarmónicos que se apagan solos. */
function ding(a, out, t0, freq, vol = 1, len = 1.4) {
  const parts = [[1, 1], [2.32, 0.45], [4.25, 0.22], [6.63, 0.1]];
  parts.forEach(([ratio, amp], i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    const end = t0 + len / (1 + i * 0.8);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(amp * vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(end + 0.05);
  });
}

/** Cascabeles de trineo (tema navideño): golpecitos de ruido agudo. */
function jingle(a, out, t0, shakes = 5) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, Math.round(a.sampleRate * 0.2), a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  for (let k = 0; k < shakes; k++) {
    const t = t0 + k * 0.085 + (k % 2) * 0.015;
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    const hp = a.createBiquadFilter();
    hp.type = 'bandpass'; hp.frequency.value = 7200 + (k % 3) * 900; hp.Q.value = 2.5;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(hp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.15);
  }
}

function chime(kind, force) {
  if (avisosMuted && !force) return;
  const a = audio();
  if (!a) return;
  const out = a.createGain();
  out.gain.value = 0.22;
  out.connect(a.destination);
  const t0 = a.currentTime + 0.03;
  if (XMAS) jingle(a, out, t0, kind === 'turno' ? 3 : 6);
  const t1 = t0 + (XMAS ? 0.12 : 0);
  if (kind === 'espera') { ding(a, out, t1, 1568); ding(a, out, t1 + 0.2, 1568, 0.85); }          // ¡din-din! como el timbre de la recepción
  else if (kind === 'lista') [1047, 1319, 1568, 2093].forEach((f, i) => ding(a, out, t1 + i * 0.11, f, 0.7, 1.1)); // arpegio de fiesta
  else ding(a, out, t1, 1319, 0.6, 1.1);                                                              // un din suave
}

/* ---- Controles: silencio (botón arriba) y notificaciones (en la recepción) ---- */
const muteBtn = document.createElement('button');
muteBtn.className = 'pixel-btn';
muteBtn.id = 'btn-mute';
document.querySelector('.hud-actions').insertBefore(muteBtn, document.querySelector('#btn-goto'));
function paintMute() {
  muteBtn.textContent = avisosMuted ? '🔇' : '🔊';
  muteBtn.title = avisosMuted ? 'Avisos en silencio: clic para volver a oír la campanita' : 'Silenciar los avisos (campanita y notificaciones)';
  muteBtn.setAttribute('aria-pressed', String(avisosMuted));
  muteBtn.setAttribute('aria-label', muteBtn.title);
}
function toggleMute() {
  avisosMuted = !avisosMuted;
  try { localStorage.setItem(LS_MUTE, avisosMuted ? '1' : '0'); } catch {}
  paintMute();
  toast(avisosMuted ? '🔇 Avisos en silencio: sin campanita ni notificaciones (los toasts siguen).' : '🔊 Avisos con campanita.', 'info', 3500);
  if (!avisosMuted) chime('turno');
  document.querySelectorAll('.avisos-foot').forEach(mountAvisosControls);
}
muteBtn.addEventListener('click', toggleMute);
paintMute();

function notifState() {
  if (!('Notification' in window)) return 'none';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && avisosNotif ? 'on' : 'off';
}

/** Pie de la recepción: silencio, notificaciones de Windows y botón para probar. */
function mountAvisosControls(el) {
  if (!el) return;
  const st = notifState();
  const notifBtn = {
    none: '<span class="note">Sin notificaciones en este navegador</span>',
    denied: '<span class="note" title="Para activarlas, cámbialo en el candado de la barra de dirección">🚫 Notificaciones bloqueadas</span>',
    on: '<button class="pixel-btn" data-av-notif title="Salen cuando la oficina no está al frente. Clic para apagarlas.">🖥️ Windows: SÍ</button>',
    off: '<button class="pixel-btn" data-av-notif title="Te pide permiso al pulsar">🖥️ Avisar en Windows</button>',
  }[st];
  el.innerHTML = `
    <div class="foot-row avisos-row" title="Avisan cuando un hilo te espera, completa su lista o termina un turno">
      <span class="note">🔔 Avisos:</span>
      <button class="pixel-btn" data-av-mute>${avisosMuted ? '🔇 En silencio' : '🔊 Con campanita'}</button>
      ${notifBtn}
      <button class="pixel-btn ghost" data-av-test>▶ Probar</button>
    </div>`;
  el.querySelector('[data-av-mute]').addEventListener('click', toggleMute);
  el.querySelector('[data-av-notif]')?.addEventListener('click', async () => {
    if (notifState() === 'on') {
      avisosNotif = false;
    } else {
      // El permiso se pide solo aquí, al pulsar.
      let perm = Notification.permission;
      if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }
      avisosNotif = perm === 'granted';
      if (avisosNotif) toast('🖥️ Listo: te aviso en Windows cuando la oficina no esté al frente.', 'ok', 4000);
    }
    try { localStorage.setItem(LS_NOTIF, avisosNotif ? '1' : '0'); } catch {}
    mountAvisosControls(el);
  });
  el.querySelector('[data-av-test]').addEventListener('click', () => {
    const t = allThreads().find(x => x.status === 'espera') || allThreads()[0];
    chime('espera', true);
    toast(`${XMAS ? '🎅' : '🛎️'} ¡Din-din! Así suenan los avisos${avisosMuted ? ' (ahora están en silencio)' : ''}.`, 'ok', 3500);
    if (t) { avisoAnim.set(t.id, { start: performance.now(), kind: 'espera' }); if (notifState() === 'on') avisoSystem([{ id: t.id, kind: 'espera', t }], true); }
  });
}

/* ---- Los toasts van siempre debajo de la barra de arriba (si la barra ocupa dos filas, no le tapan los botones) ---- */
const hudBar = document.querySelector('.hud');
const placeToasts = () => { $('#toasts').style.top = `${Math.round(hudBar.getBoundingClientRect().bottom + 10)}px`; };
if (window.ResizeObserver) new ResizeObserver(placeToasts).observe(hudBar);
addEventListener('resize', placeToasts);
placeToasts();

/* ---- Que el título se mantenga al cambiar de tema, y que los avisos lleguen con la ventana tapada ---- */
new MutationObserver(avisoTitle).observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true });
setInterval(() => { if (document.hidden) refresh(); }, 20000); // game.js solo refresca con la ventana visible
if (world) { avisoPrev = avisoSnap(world); avisoTitle(); }      // por si el primer refresco llegó antes que este archivo
