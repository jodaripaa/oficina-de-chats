// Voces premium (ElevenLabs) — cliente del juego. Modo opcional y APAGADO por defecto: se enciende en la
// ayuda (?) con «🎙️ Voces premium (ElevenLabs)» y se recuerda en este navegador.
//
// Misma forma que window.Voz (voz.js, las voces gratis de Edge), para usarlas igual:
//   VozElevenLabs.disponible()               ¿encendidas y el navegador puede reproducir?
//   VozElevenLabs.hablar(texto, { id })      → Promise, termina cuando acaba de sonar
//                                            (id: el id del hilo, o 'santa' / 'recepcion')
//   VozElevenLabs.callar()
//   VozElevenLabs.grabarYTranscribir()       → { listo, detener() → Promise<string>, cancelar() }
// Cada frase nueva la genera el panel de Claude con el conector de ElevenLabs (gasta créditos); el
// servidor la guarda y la misma frase con la misma voz ya no se vuelve a pagar.
(function () {
  'use strict';
  const TOKEN = (document.querySelector('meta[name="oficina-token"]') || {}).content || '';
  const CLAVE = 'oficina-voz-premium';
  const MAX_LETRAS = 400;
  const MAX_GRABACION_MS = 60000;
  // El conector de ElevenLabs todavía no recibe grabaciones del PC (solo enlaces https públicos o archivos
  // que la persona elige a mano en el chat). Con false, el juego no muestra el botón 🎙️ premium.
  const TRANSCRIBIR_LISTO = false;

  let encendido = false;
  try { encendido = localStorage.getItem(CLAVE) === '1'; } catch {}
  let sonando = null; // { audio, fin } de lo que suena ahora
  let turno = 0; // sube con cada hablar() y callar(): una respuesta que llega tarde ya no suena

  const esperar = ms => new Promise(r => setTimeout(r, ms));

  /** Deja una orden para el panel y espera su resultado (o lo devuelve al momento si ya estaba guardado). */
  async function orden(payload, timeoutMs, seguir) {
    const r = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Oficina-Token': TOKEN },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo.');
    if (j.status && j.status !== 'pending') return j;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await esperar(1000);
      if (seguir && !seguir()) return null;
      const res = await fetch(`/api/action?id=${encodeURIComponent(j.id)}`).then(x => x.json()).catch(() => null);
      if (res && res.status && res.status !== 'pending') return res;
    }
    throw new Error('El panel de Claude no respondió: abre la oficina desde Claude para usar las voces premium.');
  }

  /** Quita marcas de formato y corta en la última palabra que quepa. */
  function limpiar(texto) {
    const t = String(texto || '').replace(/[`*_#>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length <= MAX_LETRAS) return t;
    const corte = t.lastIndexOf(' ', MAX_LETRAS - 1);
    return `${t.slice(0, corte > MAX_LETRAS / 2 ? corte : MAX_LETRAS - 1)}…`;
  }

  function pararAudio() {
    if (!sonando) return;
    const { audio, fin } = sonando;
    sonando = null;
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch {}
    fin();
  }

  async function hablar(texto, opciones) {
    const id = (opciones && opciones.id) || 'recepcion';
    if (!encendido) throw new Error('Las voces premium están apagadas (enciéndelas en la ayuda).');
    const text = limpiar(texto);
    if (!text) return;
    const mio = ++turno;
    pararAudio();
    const res = await orden({ type: 'speak', text, threadId: id }, 90000, () => mio === turno);
    if (!res || mio !== turno) return; // alguien llamó callar() o hablar() mientras tanto
    if (res.status === 'error') throw new Error(res.detail || 'No se pudo generar la voz.');
    if (!res.audio) throw new Error('El panel no devolvió el audio.');
    await new Promise((resolve, reject) => {
      const audio = new Audio(`/api/audio?id=${encodeURIComponent(res.audio)}`);
      const fin = () => resolve();
      sonando = { audio, fin };
      audio.onended = () => { if (sonando && sonando.audio === audio) sonando = null; resolve(); };
      audio.onerror = () => { if (sonando && sonando.audio === audio) sonando = null; reject(new Error('No pude reproducir el audio.')); };
      audio.play().catch(err => {
        if (sonando && sonando.audio === audio) sonando = null;
        reject(new Error(err && err.name === 'NotAllowedError' ? 'El navegador bloqueó el sonido: haz clic en la ventana y prueba otra vez.' : 'No pude reproducir el audio.'));
      });
    });
  }

  function callar() {
    turno++;
    pararAudio();
  }

  function grabarYTranscribir() {
    let rec = null;
    let stream = null;
    let cancelado = false;
    let corte = null;
    let fin = Promise.resolve();
    const partes = [];
    const soltar = () => { clearTimeout(corte); if (stream) stream.getTracks().forEach(t => t.stop()); };
    const listo = (async () => {
      if (!encendido) throw new Error('Las voces premium están apagadas (enciéndelas en la ayuda).');
      if (!TRANSCRIBIR_LISTO) throw new Error('La transcripción premium todavía no está disponible.');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este navegador no puede grabar.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelado) { soltar(); throw new Error('Grabación cancelada.'); }
      const tipo = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      rec = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 32000 } : undefined);
      rec.ondataavailable = e => { if (e.data && e.data.size) partes.push(e.data); };
      fin = new Promise(r => { rec.onstop = r; });
      rec.start(1000);
      corte = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, MAX_GRABACION_MS); // máximo un minuto
    })();
    listo.catch(() => {});

    async function detener() {
      await listo;
      if (rec.state !== 'inactive') rec.stop();
      await fin;
      soltar();
      if (cancelado) throw new Error('Grabación cancelada.');
      const blob = new Blob(partes, { type: String(rec.mimeType || 'audio/webm').split(';')[0] });
      if (blob.size < 200) throw new Error('No se oyó nada.');
      const up = await fetch('/api/audio-upload', { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Oficina-Token': TOKEN }, body: blob });
      const j = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(j.error || 'No pude subir la grabación.');
      const res = await orden({ type: 'transcribe', upload: j.upload }, 120000);
      if (res.status === 'error') throw new Error(res.detail || 'No se pudo transcribir.');
      return String(res.text || '').trim();
    }
    function cancelar() {
      cancelado = true;
      if (rec && rec.state !== 'inactive') rec.stop();
      soltar();
    }
    return { listo, detener, cancelar };
  }

  function encender(si) {
    encendido = Boolean(si);
    try { localStorage.setItem(CLAVE, encendido ? '1' : '0'); } catch {}
    if (!encendido) callar();
    window.dispatchEvent(new CustomEvent('voz-premium', { detail: { encendido } }));
  }

  window.VozElevenLabs = {
    disponible: () => encendido && typeof Audio !== 'undefined' && Boolean(TOKEN),
    hablar,
    callar,
    grabarYTranscribir,
    // Extras de este modo (no están en window.Voz):
    encendido: () => encendido,
    encender,
    puedeTranscribir: () => encendido && TRANSCRIBIR_LISTO && typeof MediaRecorder !== 'undefined',
    MAX_LETRAS,
  };
})();
