// Baja el audio que generó ElevenLabs y lo guarda en data/audio/<hash>.mp3 del juego.
// Lo ejecuta el panel "Oficina" con node porque el panel solo escribe texto, no bytes.
//   node bajar-audio.cjs <url https> <ruta>/data/audio/<hash de 32>.mp3
// Solo acepta enlaces https de ElevenLabs (o su almacenamiento), hasta 8 MB, y escribe solo en data/audio.
const https = require('https');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 8 * 1024 * 1024;
const HOSTS = [/(^|\.)elevenlabs\.io$/i, /(^|\.)elevenlabsusercontent\.com$/i, /^storage\.googleapis\.com$/i];

const die = msg => { process.stderr.write(msg); process.exit(1); };

const [url, out] = process.argv.slice(2);
if (!url || !out) die('Uso: node bajar-audio.cjs <url> <salida.mp3>');
const full = path.resolve(out);
if (!/^[a-f0-9]{32}\.mp3$/.test(path.basename(full))) die('Nombre de audio inválido.');
const dir = path.dirname(full);
if (path.basename(dir) !== 'audio' || path.basename(path.dirname(dir)) !== 'data') die('Solo se guarda en data/audio.');

const allowed = u => {
  let x;
  try { x = new URL(u); } catch { return false; }
  return x.protocol === 'https:' && HOSTS.some(re => re.test(x.hostname));
};

function get(u, hops) {
  return new Promise((resolve, reject) => {
    if (!allowed(u)) return reject(new Error('Ese enlace no es de ElevenLabs.'));
    const req = https.get(u, { headers: { 'User-Agent': 'oficina-de-chats' }, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops >= 3) return reject(new Error('Demasiadas redirecciones.'));
        return resolve(get(new URL(res.headers.location, u).toString(), hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`ElevenLabs respondió ${res.statusCode}.`)); }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (type && !/^(audio\/|application\/octet-stream|binary\/octet-stream)/.test(type)) { res.resume(); return reject(new Error(`No es audio (${type}).`)); }
      const parts = [];
      let total = 0;
      res.on('data', c => {
        total += c.length;
        if (total > MAX_BYTES) { req.destroy(new Error('El audio es demasiado grande.')); return; }
        parts.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(parts)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('ElevenLabs tardó demasiado en entregar el audio.')));
    req.on('error', reject);
  });
}

get(url, 0).then(buf => {
  if (buf.length < 100) throw new Error('El audio llegó vacío.');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${full}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, full);
  try { fs.unlinkSync(full.replace(/\.mp3$/, '.pending.json')); } catch {}
  process.stdout.write(JSON.stringify({ ok: true, bytes: buf.length }));
}).catch(e => die(String(e && e.message || e)));
