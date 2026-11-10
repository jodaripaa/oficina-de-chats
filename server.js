// Oficina de chats — servidor local del juego (sin dependencias).
// Lee los hilos de Claude Code en ~/.claude/projects, arma el "mundo" (proyectos y escritorios),
// entrega la bitácora de cada hilo y deja en data/queue las órdenes que el panel de Claude ejecuta.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 4317;
const CLAUDE_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const QUEUE_DIR = path.join(DATA_DIR, 'queue');
const DONE_DIR = path.join(DATA_DIR, 'done');
const LIVE_FILE = path.join(DATA_DIR, 'live.json');
const TOKEN_FILE = path.join(DATA_DIR, 'token.txt');
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

fs.mkdirSync(QUEUE_DIR, { recursive: true });
fs.mkdirSync(DONE_DIR, { recursive: true });
let TOKEN;
try { TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch {}
if (!TOKEN || TOKEN.length < 32) { TOKEN = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(TOKEN_FILE, TOKEN); }
// Voces premium (ElevenLabs): órdenes speak/transcribe, audio guardado y subida de grabaciones.
const voz = require('./voces-premium').create({ dataDir: DATA_DIR, token: TOKEN, findThread: id => findThread(id), queueDir: QUEUE_DIR, doneDir: DONE_DIR });

/* ------------------------------------------------------------------ */
/* Lectura de hilos                                                     */
/* ------------------------------------------------------------------ */

const summaryCache = new Map(); // file -> { m, s, d }
const idToFile = new Map();

const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';
const clean = t => String(t || '')
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  .replace(/<(command-[a-z-]+|local-command-[a-z-]+|task-notification|ide_[a-z_]+)>[\s\S]*?<\/\1>/g, '')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const oneLine = t => clean(t).replace(/\s+/g, ' ');
const repoRoot = cwd => {
  if (!cwd) return null;
  const m = cwd.match(/^(.*?)[\\/](?:\.claude[\\/]worktrees|output[\\/]worktrees)[\\/]/i);
  return m ? m[1] : cwd;
};
const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

function applyDelta(plan, inp) {
  if (inp.advance) {
    const i = plan.findIndex(p => p.status === 'in_progress');
    if (i >= 0) {
      plan[i].status = 'completed';
      const n = plan.findIndex((p, j) => j > i && p.status === 'pending');
      if (n >= 0) plan[n].status = 'in_progress';
    }
  }
  if (Array.isArray(inp.done)) inp.done.forEach(n => { if (plan[n - 1]) plan[n - 1].status = 'completed'; });
  if (typeof inp.start === 'number' && plan[inp.start - 1]) {
    plan.forEach(p => { if (p.status === 'in_progress') p.status = 'pending'; });
    plan[inp.start - 1].status = 'in_progress';
  }
}

/** Recorre un hilo completo. Con `history` arma además la bitácora por turnos. */
async function walk(file, history) {
  const d = { id: path.basename(file, '.jsonl'), title: null, first: null, last: null, cwd: null, branch: null,
    created: null, updated: null, msgs: 0, plan: null, recap: null, ask: null, closed: false, tools: 0, files: 0 };
  const turns = [];
  const files = new Map();
  let turn = null;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'custom-title' && o.customTitle) d.title = o.customTitle;
    if (o.type === 'summary' && o.summary && !d.title) d.title = o.summary;
    if (o.timestamp) { if (!d.created) d.created = o.timestamp; d.updated = o.timestamp; }
    if (o.cwd && !d.cwd) d.cwd = o.cwd;
    if (o.gitBranch) d.branch = o.gitBranch;
    if (o.isSidechain || !o.message) continue;
    const m = o.message;
    if (o.type === 'user' && m.role === 'user' && !o.isMeta) {
      const raw = textOf(m.content);
      const t = clean(raw);
      if (t) {
        d.msgs++;
        const flat = t.replace(/\s+/g, ' ');
        if (!d.first) d.first = flat.slice(0, 200);
        d.last = flat.slice(0, 200);
        d.closed = false;
        if (history) {
          turn = { t: o.timestamp || null, prompt: cut(t, 1500), replies: [], recap: null, ask: null, plan: null, tools: 0, files: [] };
          turns.push(turn);
        }
      }
    }
    if (o.type === 'assistant' && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type === 'text' && history && turn && c.text && c.text.trim().length > 2) {
          turn.replies.push(c.text.trim());
        }
        if (c.type !== 'tool_use') continue;
        d.tools++;
        if (turn) turn.tools++;
        const inp = c.input || {};
        if (c.name === 'mcp__ccd_turn__update_plan') {
          if (Array.isArray(inp.items)) d.plan = inp.items.map(i => ({ content: String(i.content), status: i.status }));
          else if (d.plan) applyDelta(d.plan, inp);
          if (turn && d.plan) turn.plan = d.plan.map(p => ({ ...p }));
        } else if (c.name === 'TodoWrite' && Array.isArray(inp.todos)) {
          d.plan = inp.todos.map(i => ({ content: String(i.content), status: i.status }));
          if (turn) turn.plan = d.plan.map(p => ({ ...p }));
        } else if (c.name === 'mcp__ccd_turn__wrap_up') {
          if (inp.recap) d.recap = inp.recap;
          d.ask = inp.ask || null;
          d.closed = true;
          if (d.plan) d.plan.forEach(p => { p.status = 'completed'; });
          if (turn) { turn.recap = inp.recap || null; turn.ask = inp.ask || null; if (turn.plan) turn.plan.forEach(p => { p.status = 'completed'; }); }
        } else if ((c.name === 'Write' || c.name === 'Edit' || c.name === 'NotebookEdit') && (inp.file_path || inp.notebook_path)) {
          const f = inp.file_path || inp.notebook_path;
          files.set(f, (files.get(f) || 0) + 1);
          if (turn && !turn.files.includes(f)) turn.files.push(f);
        }
      }
    }
  }
  d.files = files.size;
  if (!history) return d;
  return {
    ...d,
    turns: turns.map(t => ({
      t: t.t,
      prompt: t.prompt,
      reply: t.replies.length ? cut(t.replies[t.replies.length - 1], 2500) : null,
      recap: t.recap, ask: t.ask, plan: t.plan, tools: t.tools, files: t.files.slice(0, 30),
    })),
    fileList: [...files.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => ({ file: f, edits: n })),
  };
}

async function summaryOf(file) {
  const st = fs.statSync(file);
  const hit = summaryCache.get(file);
  if (hit && hit.m === st.mtimeMs && hit.s === st.size) return hit.d;
  const d = await walk(file, false);
  summaryCache.set(file, { m: st.mtimeMs, s: st.size, d });
  return d;
}

/* ------------------------------------------------------------------ */
/* El mundo: proyectos, escritorios y estado en vivo                   */
/* ------------------------------------------------------------------ */

const norm = p => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
let lastWorld = null;

function readLive() {
  try {
    const j = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
    const fresh = Date.now() - new Date(j.updated).getTime() < 90e3;
    return { fresh, sessions: Array.isArray(j.sessions) ? j.sessions : [] };
  } catch { return { fresh: false, sessions: [] }; }
}

async function buildWorld() {
  const now = Date.now();
  const live = readLive();
  const used = new Set();
  const projects = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true }).filter(e => e.isDirectory()); } catch {}
  for (const dir of dirs) {
    const full = path.join(CLAUDE_DIR, dir.name);
    let list = [];
    try { list = fs.readdirSync(full).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of list) {
      const file = path.join(full, f);
      let d; try { d = await summaryOf(file); } catch { continue; }
      if (!d.updated || !d.msgs) continue;
      idToFile.set(d.id, file);
      const scratch = /AppData[\\/]/i.test(d.cwd || '') || /AppData/i.test(dir.name);
      const root = scratch ? '__borradores__' : (repoRoot(d.cwd) || dir.name);
      const key = root.toLowerCase();
      if (!projects.has(key)) projects.set(key, { key, name: scratch ? 'Borradores' : path.basename(root), path: scratch ? null : root, updated: d.updated, threads: [] });
      const p = projects.get(key);

      const same = live.sessions.filter(s => !used.has(s.sessionId) && norm(s.cwd) === norm(d.cwd));
      let s = same.find(x => d.title && x.title === d.title);
      if (!s) {
        s = same.map(x => ({ x, dt: Math.abs(new Date(x.lastActivityAt || 0) - new Date(d.updated)) }))
          .filter(o => o.dt < 5 * 60e3).sort((a, b) => a.dt - b.dt)[0]?.x;
      }
      if (s) used.add(s.sessionId);
      const age = now - new Date(d.updated).getTime();
      let status;
      if (s?.isRunning || (!live.fresh && age < 3 * 60e3)) status = 'trabajando';
      else if (d.closed && d.ask && age < 7 * 864e5) status = 'espera';
      else if (age < 864e5) status = 'hoy';
      else if (age < 7 * 864e5) status = 'semana';
      else status = 'dormido';

      const done = d.plan ? d.plan.filter(x => x.status === 'completed').length : 0;
      p.threads.push({
        id: d.id,
        title: s?.title || d.title || d.first || 'Hilo sin título',
        status, updated: d.updated, created: d.created, msgs: d.msgs, tools: d.tools, files: d.files,
        branch: d.branch, worktree: d.cwd && repoRoot(d.cwd) !== d.cwd ? path.basename(d.cwd) : null,
        plan: d.plan, done, total: d.plan ? d.plan.length : 0,
        current: d.plan ? (d.plan.find(x => x.status === 'in_progress') || {}).content || null : null,
        recap: d.recap, ask: d.closed ? d.ask : null, last: d.last,
        canMessage: Boolean(s), canOpen: Boolean(s && s.link),
        sessionId: s?.sessionId || null, link: s?.link || null,
      });
      if (d.updated > p.updated) p.updated = d.updated;
    }
  }
  const order = ['trabajando', 'espera', 'hoy', 'semana', 'dormido'];
  const list = [...projects.values()].map(p => {
    p.threads.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.updated.localeCompare(a.updated));
    return p;
  }).sort((a, b) => b.updated.localeCompare(a.updated));
  lastWorld = { generated: new Date().toISOString(), isLive: live.fresh, projects: list };
  return lastWorld;
}

/** Lo que ve el navegador: sin session_id ni enlaces (esos solo los usa el puente). */
function publicWorld(w) {
  return {
    ...w,
    projects: w.projects.map(p => ({
      ...p,
      threads: p.threads.map(({ sessionId, link, ...t }) => t),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Órdenes para el panel de Claude                                     */
/* ------------------------------------------------------------------ */

function findThread(id) {
  for (const p of lastWorld?.projects || []) {
    const t = p.threads.find(x => x.id === id);
    if (t) return { p, t };
  }
  return null;
}

function makeAction(body) {
  const type = String(body.type || '');
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
  if (type === 'send') {
    const hit = findThread(String(body.threadId || ''));
    if (!hit?.t.sessionId) throw new Error('Ese hilo no está abierto en la app.');
    if (!message) throw new Error('Escribe la instrucción.');
    return { type, title: hit.t.title, sessionId: hit.t.sessionId, message };
  }
  if (type === 'open' || type === 'archive') {
    const hit = findThread(String(body.threadId || ''));
    if (!hit?.t.sessionId) throw new Error('Ese hilo no está abierto en la app.');
    return { type, title: hit.t.title, sessionId: hit.t.sessionId, link: hit.t.link };
  }
  if (type === 'broadcast') {
    const p = (lastWorld?.projects || []).find(x => x.key === body.projectKey);
    if (!p) throw new Error('No encontré esa oficina.');
    const targets = p.threads.filter(t => t.sessionId && ['hoy', 'semana', 'espera'].includes(t.status))
      .map(t => ({ sessionId: t.sessionId, title: t.title }));
    if (!targets.length) throw new Error('No hay hilos disponibles para preguntarles.');
    return { type, project: p.name, targets, message: message || 'Dame un resumen corto de cómo vas: qué está hecho, qué falta y si algo te bloquea.' };
  }
  if (type === 'create') {
    const p = (lastWorld?.projects || []).find(x => x.key === body.projectKey);
    if (!p?.path) throw new Error('Esta oficina no tiene carpeta de proyecto.');
    if (!message) throw new Error('Escribe la tarea del hilo nuevo.');
    return { type, project: p.name, cwd: p.path, message };
  }
  if (type === 'speak' || type === 'transcribe') return voz.makeAction(type, body);
  throw new Error('Orden desconocida.');
}

function cleanupDone() {
  const limit = Date.now() - 24 * 3600e3;
  for (const dir of [QUEUE_DIR, DONE_DIR]) {
    for (const f of fs.readdirSync(dir)) {
      try { if (fs.statSync(path.join(dir, f)).mtimeMs < limit) fs.unlinkSync(path.join(dir, f)); } catch {}
    }
  }
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                 */
/* ------------------------------------------------------------------ */

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(String(req.headers.host || ''))) { res.writeHead(403); return res.end('host no permitido'); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api/world') return json(res, 200, publicWorld(await buildWorld()));

    if (url.pathname === '/api/thread') {
      if (!lastWorld) await buildWorld();
      const id = String(url.searchParams.get('id') || '');
      const file = idToFile.get(id);
      if (!file) return json(res, 404, { error: 'No encontré ese hilo.' });
      const h = await walk(file, true);
      return json(res, 200, { id, turns: h.turns.slice(-80), fileList: h.fileList.slice(0, 80), tools: h.tools, msgs: h.msgs, created: h.created, updated: h.updated, branch: h.branch, cwd: h.cwd });
    }

    if (url.pathname === '/api/action' && req.method === 'POST') {
      if (req.headers['x-oficina-token'] !== TOKEN) return json(res, 403, { error: 'Token inválido. Recarga la ventana.' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 20000) return json(res, 413, { error: 'Muy largo' }); }
      if (!lastWorld) await buildWorld();
      let action;
      try { action = makeAction(JSON.parse(body)); } catch (e) { return json(res, 400, { error: e.message }); }
      if (action.immediate) return json(res, 200, action.immediate);
      const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(path.join(QUEUE_DIR, `${id}.json`), JSON.stringify({ id, created: new Date().toISOString(), ...action }));
      voz.queued(action, id);
      cleanupDone();
      return json(res, 200, { id, status: 'pending' });
    }

    if (url.pathname === '/api/action' && req.method === 'GET') {
      const id = String(url.searchParams.get('id') || '').replace(/[^a-z0-9-]/gi, '');
      try { return json(res, 200, JSON.parse(fs.readFileSync(path.join(DONE_DIR, `${id}.json`), 'utf8'))); }
      catch { return json(res, 200, { id, status: 'pending' }); }
    }

    if (await voz.handle(req, res, url)) return;

    // Archivos del juego. El token va dentro de la página: otras webs no pueden leerlo.
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end('no encontrado'); }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    if (rel === 'index.html') {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(file, 'utf8').replace('__OFICINA_TOKEN__', TOKEN));
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 500, { error: String(e && e.message) });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log(`La oficina ya está abierta en http://localhost:${PORT}`); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Oficina de chats lista en http://localhost:${PORT}`);
});
