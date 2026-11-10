// Voces premium (ElevenLabs) — parte del servidor. Modo opcional: el juego solo lo usa si la persona
// enciende «🎙️ Voces premium» en la ayuda. Aquí se arman las órdenes `speak` y `transcribe` que el
// panel de Claude ejecuta con el conector de ElevenLabs, se sirve el audio ya generado y se reciben
// las grabaciones cortas del micrófono.
//
// Archivos (todos dentro de data/, que no se sube a git):
//   data/voces.json         qué voz tiene cada empleado (id de hilo), Santa y la recepcionista
//   data/audio/<hash>.mp3   frases ya generadas: caché por texto + voz + modelo (no se vuelve a pagar)
//   data/uploads/<id>.<ext> grabaciones para transcribir (se borran solas a los 30 minutos)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Catálogo de voces en español (sacado de creative_list_voices). Solo los id viajan al conector. */
const CATALOGO = {
  santa: { id: '2lj4aExF052KSi14NJCI', nombre: 'Oslo — abuelo cuentacuentos, cálido' },
  recepcion: { id: '5Cv0Ai2PG63GLyPEHsNy', nombre: 'María — natural y amable, atención al cliente' },
  empleados: [
    { id: '5v6YSGBv8Rbr7ufiFR1t', nombre: 'Nicolás — tranquilo y natural' },
    { id: 'fSdfFSsuhxAbMOq35MJx', nombre: 'Hellen — juvenil y suave' },
    { id: 'JIfdwGbJNfJKbPNRYqP2', nombre: 'Isaak — joven, con energía' },
    { id: 'lP1VZ61RLnDtOoz41b3D', nombre: 'Jade — alegre y dinámica' },
    { id: 'k1LcwPlB8fqtr2BOqzNo', nombre: 'Edinson — pausado y tranquilo' },
    { id: 'YLtqUTaEXb7a9MAYuJu4', nombre: 'Julieta — cálida y cercana' },
    { id: 'ZWAc39Qddhao7EK9alfc', nombre: 'Chris — claro y natural' },
    { id: 'B3n50MWEiQYRmAiqw6mg', nombre: 'Alejandra — juvenil y tranquila' },
    { id: 'dcEM0WOwbt9XwI31mBIu', nombre: 'Chuysito — joven y simpático' },
    { id: '5yNXxdAaHAkq8N8bGqwQ', nombre: 'Catalina — amigable y clara' },
    { id: 'JZeTbA8jDZKTeMBPNXrK', nombre: 'Marco — natural y divertido' },
    { id: 'zJtOCbdQjTZt7YZtkRDP', nombre: 'Natalia — versátil, de doblaje' },
  ],
};
// Idea para después (sin usar, gasta créditos): con creative_design_voice se puede diseñar una voz
// propia por personaje (p. ej. «Santa latino, risueño, voz grave y lenta») y guardarla con
// creative_save_designed_voice; su voice_id nuevo reemplazaría al de CATALOGO.santa.

const MODELOS = ['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_multilingual_v2', 'eleven_v3', 'eleven_v4'];
const MODELO = MODELOS.includes(process.env.OFICINA_VOZ_MODELO) ? process.env.OFICINA_VOZ_MODELO : 'eleven_flash_v2_5';
const MAX_TEXTO = 400;
const MAX_SUBIDA = 6 * 1024 * 1024; // ~60 s de opus sobran con 1 MB; esto deja margen para wav cortos
const TIPOS_AUDIO = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
const LIMITE = { ordenes: 20, ventanaMs: 10 * 60e3 }; // tope de frases nuevas (pagadas) por ventana
const ESPECIALES = new Set(['santa', 'recepcion']);
const ID_RE = /^[a-z0-9-]{1,64}$/i;
const AUDIO_RE = /^[a-f0-9]{32}$/;
const SUBIDA_RE = /^[a-z0-9-]{8,40}\.(webm|ogg|m4a|mp3|wav)$/;

function create({ dataDir, token, findThread, queueDir, doneDir }) {
  const AUDIO_DIR = path.join(dataDir, 'audio');
  const UPLOAD_DIR = path.join(dataDir, 'uploads');
  const VOCES_FILE = path.join(dataDir, 'voces.json');
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  /* ---- Voces: una por empleado, estable y guardada ---- */
  let voces = null;
  const cargarVoces = () => {
    if (voces) return voces;
    try { voces = JSON.parse(fs.readFileSync(VOCES_FILE, 'utf8')); } catch { voces = null; }
    if (!voces || typeof voces !== 'object') voces = {};
    if (!voces.hilos || typeof voces.hilos !== 'object') voces.hilos = {};
    voces.santa = voces.santa || CATALOGO.santa.id;
    voces.recepcion = voces.recepcion || CATALOGO.recepcion.id;
    return voces;
  };
  /** La voz de un empleado: la que ya tenía o, si es nuevo, la menos usada (el empate lo decide su id). */
  function vozDe(id) {
    const v = cargarVoces();
    if (ESPECIALES.has(id)) return v[id];
    if (v.hilos[id]) return v.hilos[id];
    const uso = new Map(CATALOGO.empleados.map(e => [e.id, 0]));
    for (const x of Object.values(v.hilos)) if (uso.has(x)) uso.set(x, uso.get(x) + 1);
    const menor = Math.min(...uso.values());
    const libres = CATALOGO.empleados.filter(e => uso.get(e.id) === menor);
    const n = parseInt(crypto.createHash('sha256').update(id).digest('hex').slice(0, 8), 16);
    v.hilos[id] = libres[n % libres.length].id;
    try { fs.writeFileSync(VOCES_FILE, JSON.stringify(v, null, 2)); } catch {}
    return v.hilos[id];
  }

  const audioHash = (texto, voz, modelo) => crypto.createHash('sha256').update(`${modelo}\n${voz}\n${texto}`).digest('hex').slice(0, 32);
  const audioFile = hash => path.join(AUDIO_DIR, `${hash}.mp3`);

  /* ---- Órdenes ---- */
  const enCurso = new Map(); // hash -> id de la orden en cola (evita pagar dos veces la misma frase)
  let recientes = []; // horas de las órdenes speak que sí irán a ElevenLabs

  function ordenPendiente(hash) {
    const id = enCurso.get(hash);
    if (!id) return null;
    const enCola = fs.existsSync(path.join(queueDir, `${id}.json`));
    const hecha = fs.existsSync(path.join(doneDir, `${id}.json`));
    const viva = Date.now() - parseInt(id.split('-')[0], 36) < 10 * 60e3;
    if (enCola && !hecha && viva) return id;
    enCurso.delete(hash);
    return null;
  }

  /**
   * Arma la orden. Devuelve { immediate } cuando no hace falta el panel (frase ya guardada o ya pedida),
   * o la orden que el servidor deja en data/queue.
   */
  function makeAction(type, body) {
    if (type === 'speak') {
      const texto = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
      if (!texto) throw new Error('No hay nada que decir.');
      if (texto.length > MAX_TEXTO) throw new Error(`La frase es muy larga (máximo ${MAX_TEXTO} letras).`);
      const id = String(body.threadId || '');
      if (!ID_RE.test(id)) throw new Error('Empleado desconocido.');
      const hit = ESPECIALES.has(id) ? null : findThread(id);
      if (!ESPECIALES.has(id) && !hit) throw new Error('No encontré a ese empleado.');
      const voiceId = vozDe(id);
      const hash = audioHash(texto, voiceId, MODELO);
      if (fs.existsSync(audioFile(hash))) return { immediate: { id: null, status: 'done', detail: 'Voz lista (guardada).', audio: hash } };
      const pendiente = ordenPendiente(hash);
      if (pendiente) return { immediate: { id: pendiente, status: 'pending' } };
      const ahora = Date.now();
      recientes = recientes.filter(t => ahora - t < LIMITE.ventanaMs);
      if (recientes.length >= LIMITE.ordenes) throw new Error('Muchas voces premium seguidas: espera unos minutos (cuidamos tus créditos).');
      recientes.push(ahora);
      const quien = id === 'santa' ? 'Santa' : id === 'recepcion' ? 'Recepción' : hit.t.title;
      return { type, title: quien, text: texto, voiceId, model: MODELO, audio: hash };
    }
    if (type === 'transcribe') {
      const upload = String(body.upload || '');
      if (!SUBIDA_RE.test(upload) || !fs.existsSync(path.join(UPLOAD_DIR, upload))) throw new Error('No encontré esa grabación.');
      return { type, title: 'Transcripción', upload, language: 'es' };
    }
    throw new Error('Orden desconocida.');
  }

  /** Recuerda qué orden está generando cada frase (se llama después de escribirla en la cola). */
  function queued(action, id) {
    if (action.type === 'speak' && action.audio) enCurso.set(action.audio, id);
  }

  function limpiar() {
    const limite = Date.now() - 30 * 60e3;
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      try { if (fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs < limite) fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch {}
    }
  }

  /* ---- HTTP: audio generado y subida de grabaciones ---- */
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  async function handle(req, res, url) {
    if (url.pathname === '/api/audio' && req.method === 'GET') {
      const id = String(url.searchParams.get('id') || '');
      if (!AUDIO_RE.test(id)) return json(res, 400, { error: 'Audio inválido.' }), true;
      const file = audioFile(id);
      let st;
      try { st = fs.statSync(file); } catch { return json(res, 404, { error: 'Ese audio no existe.' }), true; }
      if (!st.isFile()) return json(res, 404, { error: 'Ese audio no existe.' }), true;
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': st.size, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(file).pipe(res);
      return true;
    }

    if (url.pathname === '/api/audio-upload' && req.method === 'POST') {
      if (req.headers['x-oficina-token'] !== token) return json(res, 403, { error: 'Token inválido. Recarga la ventana.' }), true;
      const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = TIPOS_AUDIO[tipo];
      if (!ext) return json(res, 415, { error: 'Ese formato de audio no sirve.' }), true;
      const largo = Number(req.headers['content-length'] || 0);
      if (largo > MAX_SUBIDA) return json(res, 413, { error: 'La grabación es muy larga (máximo un minuto).' }), true;
      const partes = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > MAX_SUBIDA) return json(res, 413, { error: 'La grabación es muy larga (máximo un minuto).' }), true;
        partes.push(chunk);
      }
      if (total < 200) return json(res, 400, { error: 'La grabación quedó vacía.' }), true;
      limpiar();
      const nombre = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, nombre), Buffer.concat(partes));
      return json(res, 200, { upload: nombre, bytes: total }), true;
    }
    return false;
  }

  return { makeAction, queued, handle, vozDe, audioHash, modelo: MODELO };
}

module.exports = { create, CATALOGO, MODELOS };
