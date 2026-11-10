'use strict';
/* Oficina de chats — juego en pixel art.
   Cada proyecto es una oficina; cada hilo de Claude, un escritorio con su trabajador. */

const TOKEN = document.querySelector('meta[name="oficina-token"]').content;
const T = 16; // píxeles por baldosa

const STATUS = {
  trabajando: { label: 'Trabajando', color: '#4ade80', screen: '#4ade80' },
  espera: { label: 'Te espera', color: '#fb923c', screen: '#fb923c' },
  hoy: { label: 'Activo hoy', color: '#60a5fa', screen: '#60a5fa' },
  semana: { label: 'Esta semana', color: '#fcd34d', screen: '#a16207' },
  dormido: { label: 'Dormido', color: '#94a3b8', screen: '#1f2937' },
};
const ACCENTS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
const SHIRTS = ['#ef6f51', '#2a9d8f', '#8e7dbe', '#e9b949', '#457b9d', '#d1495b', '#5fa37a', '#f4a261', '#577590', '#c77d9b'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const HAIRS = ['#2b1d14', '#4a2f1b', '#6b4423', '#151515', '#a0522d', '#d4a017', '#7a7a7a'];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => { let a = 0; for (const c of String(s)) a = (a * 31 + c.charCodeAt(0)) | 0; return Math.abs(a); };
const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const accentOf = key => ACCENTS[hash(key) % ACCENTS.length];
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'hace un momento';
  const m = Math.round(s / 60); if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24); return d === 1 ? 'ayer' : `hace ${d} días`;
}
const fmtDate = iso => iso ? new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f).map(v => v.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ */
/* Estado                                                               */
/* ------------------------------------------------------------------ */

const canvas = $('#game');
const hudEl = document.querySelector('.hud');
const ctx = canvas.getContext('2d');
let SCALE = 3;
let world = null;          // datos del servidor
let map = null;            // mapa construido
let staticLayer = null;    // baldosas y decoración ya dibujadas
let signature = '';
const threadById = new Map();
const projectByKey = new Map();
const player = { tx: 6, ty: 14, fx: 6, fy: 14, t: 1, dir: 'down', path: [], onArrive: null, walkPhase: 0 };
const cam = { x: 0, y: 0 };
const keys = new Set();
let hover = null;
let modalOpen = false;
let currentRoom = -2;
let lastTime = performance.now();
let snapCam = true;

// Tema: 'navidad' (por ahora) o 'normal'. Se recuerda en este navegador.
let XMAS = true;
try { XMAS = (localStorage.getItem('oficina-tema') || 'navidad') === 'navidad'; } catch {}
document.body.classList.toggle('navidad', XMAS);
const LIGHTS = ['#ff3b3b', '#ffd166', '#3ddc84', '#4cc9f0', '#ff7ad9'];
const flakes = Array.from({ length: 140 }, () => ({
  x: Math.random(), y: Math.random(), v: 0.03 + Math.random() * 0.06, r: Math.random() < 0.25 ? 2 : 1, p: Math.random() * 6.28,
}));

/* ------------------------------------------------------------------ */
/* Mapa                                                                 */
/* ------------------------------------------------------------------ */

const ROOM_W = 15, LOBBY_W = 12, H = 24;
const VOID = 0, FLOOR = 1, WALL = 2, CORR = 3, LOBBY = 4, DOOR = 5;
// Puestos: [columna local, fila del escritorio]. La persona se sienta una fila arriba.
const SLOTS = [[2, 3], [5, 3], [9, 3], [12, 3], [2, 7], [5, 7], [9, 7], [12, 7]];

function buildMap(data) {
  const projects = data.projects;
  const N = projects.length;
  const nTop = Math.ceil(N / 2);
  const cols = Math.max(1, nTop);
  const W = LOBBY_W + cols * ROOM_W + 1;
  const tiles = new Uint8Array(W * H);
  const roomOf = new Int16Array(W * H).fill(-1);
  const set = (x, y, v, r = -1) => { if (x >= 0 && y >= 0 && x < W && y < H) { tiles[y * W + x] = v; roomOf[y * W + x] = r; } };

  // Vestíbulo
  for (let y = 6; y <= 17; y++) for (let x = 0; x <= LOBBY_W; x++) {
    const border = x === 0 || x === LOBBY_W || y === 6 || y === 17;
    set(x, y, border ? WALL : LOBBY, border ? -1 : -10);
  }
  // Pasillo
  for (let x = LOBBY_W; x < W; x++) for (let y = 9; y <= 14; y++) set(x, y, WALL);
  for (let x = LOBBY_W; x < W - 1; x++) for (let y = 10; y <= 13; y++) set(x, y, CORR, -20);
  for (let y = 10; y <= 13; y++) set(LOBBY_W, y, CORR, -20);

  const rooms = [];
  const objects = [];
  projects.forEach((p, i) => {
    const top = i < nTop;
    const col = top ? i : i - nTop;
    const x0 = LOBBY_W + col * ROOM_W;
    const y0 = top ? 0 : 14;
    for (let ly = 0; ly <= 9; ly++) for (let lx = 0; lx <= ROOM_W; lx++) {
      const border = lx === 0 || lx === ROOM_W || ly === 0 || ly === 9;
      const x = x0 + lx, y = y0 + ly;
      if (border) { if (tiles[y * W + x] !== CORR) set(x, y, WALL); } else set(x, y, FLOOR, i);
    }
    const doorY = top ? y0 + 9 : y0;
    set(x0 + 7, doorY, DOOR, i); set(x0 + 8, doorY, DOOR, i);
    const accent = accentOf(p.key);
    const room = { i, key: p.key, name: p.name, x0, y0, top, doorY, accent, entry: { x: x0 + 7, y: top ? y0 + 8 : y0 + 1 } };
    rooms.push(room);

    const active = p.threads.filter(t => t.status !== 'dormido');
    const atDesks = active.slice(0, SLOTS.length);
    const rest = p.threads.filter(t => !atDesks.includes(t));
    atDesks.forEach((t, k) => {
      const [lx, row] = SLOTS[k];
      objects.push({ kind: 'desk', room: i, thread: t.id, x: x0 + lx, y: y0 + row - 1, w: 2, h: 2, solid: true });
    });
    objects.push({ kind: 'board', room: i, x: x0 + 10, y: y0, w: 4, h: 1, solid: true, onWall: true });
    objects.push({ kind: 'cabinet', room: i, x: x0 + 1, y: y0 + 1, w: 1, h: 1, solid: true, count: rest.length });
    objects.push({ kind: 'mail', room: i, x: x0 + 1, y: y0 + 8, w: 1, h: 1, solid: true });
    objects.push({ kind: 'mega', room: i, x: x0 + 14, y: y0 + 8, w: 1, h: 1, solid: true });
    objects.push({ kind: XMAS ? 'minitree' : 'plant', room: i, x: x0 + 14, y: y0 + 1, w: 1, h: 1, solid: true, deco: true });
    room.rest = rest.map(t => t.id);
  });

  // Vestíbulo: recepción, directorio, plantas, sofá y dispensador de agua
  objects.push({ kind: 'reception', room: -10, x: 4, y: 10, w: 4, h: 2, solid: true });
  objects.push({ kind: 'directory', room: -10, x: 3, y: 6, w: 6, h: 1, solid: true, onWall: true });
  const lobbyPlant = XMAS ? 'poinsettia' : 'plant';
  objects.push({ kind: lobbyPlant, room: -10, x: 1, y: 7, w: 1, h: 1, solid: true, deco: true });
  objects.push({ kind: lobbyPlant, room: -10, x: 11, y: 7, w: 1, h: 1, solid: true, deco: true });
  objects.push({ kind: lobbyPlant, room: -10, x: 1, y: 16, w: 1, h: 1, solid: true, deco: true });
  if (XMAS) {
    objects.push({ kind: 'xtree', room: -10, x: 9, y: 13, w: 2, h: 2, solid: true, deco: true });
    objects.push({ kind: 'snowman', room: -10, x: 7, y: 16, w: 1, h: 1, solid: true, deco: true });
  }
  objects.push({ kind: 'sofa', room: -10, x: 3, y: 15, w: 3, h: 1, solid: true, deco: true });
  objects.push({ kind: 'cooler', room: -10, x: 11, y: 16, w: 1, h: 1, solid: true, deco: true });

  const objAt = new Map();
  for (const o of objects) for (let dy = 0; dy < o.h; dy++) for (let dx = 0; dx < o.w; dx++) objAt.set(`${o.x + dx},${o.y + dy}`, o);
  return { W, H, tiles, roomOf, rooms, objects, objAt };
}

const tileAt = (x, y) => (map && x >= 0 && y >= 0 && x < map.W && y < map.H ? map.tiles[y * map.W + x] : VOID);
function walkable(x, y) {
  const t = tileAt(x, y);
  if (!(t === FLOOR || t === CORR || t === LOBBY || t === DOOR)) return false;
  const o = map.objAt.get(`${x},${y}`);
  return !(o && o.solid);
}
const roomAt = (x, y) => (map && x >= 0 && y >= 0 && x < map.W && y < map.H ? map.roomOf[y * map.W + x] : -1);

/* ------------------------------------------------------------------ */
/* Dibujo de baldosas y muebles (capa fija)                             */
/* ------------------------------------------------------------------ */

function px(c, color, x, y, w, h) { c.fillStyle = color; c.fillRect(x, y, w, h); }

function drawStatic() {
  const c = document.createElement('canvas');
  c.width = map.W * T; c.height = map.H * T;
  const g = c.getContext('2d');
  const faces = [];
  for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
    const t = tileAt(x, y);
    const bx = x * T, by = y * T;
    if (t === FLOOR || t === DOOR && roomAt(x, y) >= 0 && tileAt(x, y + 1) !== CORR && tileAt(x, y - 1) !== CORR) {
      const room = map.rooms[roomAt(x, y)];
      const base = shade(room.accent, 0.72);
      px(g, base, bx, by, T, T);
      px(g, shade(room.accent, 0.62), bx, by + 15, T, 1);
      if ((x + y) % 2 === 0) px(g, shade(room.accent, 0.78), bx + 2, by + 2, 12, 12);
    } else if (t === CORR || t === DOOR) {
      px(g, '#bdb6c9', bx, by, T, T);
      px(g, '#a59db5', bx, by, T, 1); px(g, '#a59db5', bx, by, 1, T);
      if (XMAS && t === CORR && (y === 11 || y === 12)) {
        // Alfombra roja de fiesta a lo largo del pasillo
        px(g, '#a4161a', bx, by, T, T);
        px(g, y === 11 ? '#ffd166' : '#7a0f12', bx, y === 11 ? by + 1 : by + 14, T, 1);
        if (x % 3 === 0 && y === 11) { px(g, '#c9184a', bx + 6, by + 9, 4, 4); px(g, '#ffd166', bx + 7, by + 10, 2, 2); }
      }
      if (t === DOOR) { px(g, '#8b7355', bx, by, T, 2); px(g, '#8b7355', bx, by + 14, T, 2); px(g, '#d6c7a8', bx, by + 2, T, 12); }
    } else if (t === LOBBY) {
      px(g, '#e9dfcc', bx, by, T, T);
      px(g, '#d9cdb5', bx, by, T, 1); px(g, '#d9cdb5', bx, by, 1, T);
      if ((x + y) % 2) px(g, '#efe6d6', bx + 4, by + 4, 8, 8);
    } else if (t === WALL) {
      const below = tileAt(x, y + 1);
      const face = below !== WALL && below !== VOID;
      px(g, '#3d3458', bx, by, T, T);
      px(g, '#4f4472', bx, by, T, 3);
      if (XMAS && tileAt(x, y - 1) !== WALL) { px(g, '#f8fafc', bx, by, T, 2); px(g, '#e2e8f0', bx + ((x * 7) % 11), by + 2, 4, 1); } // nieve sobre el muro
      if (face) {
        px(g, '#7a6ca6', bx, by + 6, T, 10);
        px(g, '#6a5d93', bx, by + 6, T, 2);
        px(g, '#4b416e', bx, by + 14, T, 2);
        const covered = map.objAt.get(`${x},${y}`)?.onWall;
        if (XMAS && !covered) {
          for (let i = 0; i < T; i++) px(g, i % 4 === 0 ? '#2d8a57' : '#1f6f43', bx + i, by + 7 + Math.round(2 * Math.sin((Math.PI * i) / T)), 1, 2);
          faces.push({ x, y });
        }
      }
    }
  }
  // Alfombra del vestíbulo y puerta de entrada
  if (XMAS) {
    px(g, '#1f6f43', 3 * T, 12 * T + 8, 6 * T, 2 * T); px(g, '#b91c1c', 3 * T + 3, 12 * T + 11, 6 * T - 6, 2 * T - 6);
    for (let k = 0; k < 5; k++) snowflake(g, 3 * T + 10 + k * 17, 13 * T + 4);
  } else {
    px(g, '#b84a62', 3 * T, 12 * T + 8, 6 * T, 2 * T); px(g, '#d9667f', 3 * T + 3, 12 * T + 11, 6 * T - 6, 2 * T - 6);
  }
  px(g, '#9fd3f0', 5 * T, 17 * T + 6, 2 * T, 10); px(g, '#6aa9cf', 6 * T - 1, 17 * T + 6, 2, 10);
  if (XMAS) {
    for (const [sx, sy] of [[5 * T + 3, 17 * T + 8], [5 * T + 10, 17 * T + 12], [6 * T + 5, 17 * T + 9], [6 * T + 11, 17 * T + 13]]) px(g, '#fff', sx, sy, 1, 1);
    // Coronas en cada puerta
    for (const r of map.rooms) wreath(g, (r.x0 + 9) * T + 8, r.doorY * T + (r.top ? 10 : 8));
  }

  for (const o of map.objects) drawFixed(g, o);
  map.faces = faces;
  return c;
}

function snowflake(g, x, y) {
  px(g, '#f8fafc', x - 3, y, 7, 1); px(g, '#f8fafc', x, y - 3, 1, 7);
  px(g, '#f8fafc', x - 2, y - 2, 1, 1); px(g, '#f8fafc', x + 2, y - 2, 1, 1); px(g, '#f8fafc', x - 2, y + 2, 1, 1); px(g, '#f8fafc', x + 2, y + 2, 1, 1);
}
function wreath(g, cx, cy) {
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    px(g, a % 2 ? '#166534' : '#22863a', Math.round(cx + Math.cos(ang) * 5) - 1, Math.round(cy + Math.sin(ang) * 5) - 1, 3, 3);
  }
  px(g, '#ef4444', cx - 6, cy + 2, 2, 2); px(g, '#ef4444', cx + 4, cy - 3, 2, 2); px(g, '#ffd166', cx - 1, cy - 6, 2, 2);
  px(g, '#dc2626', cx - 2, cy + 4, 5, 2); px(g, '#dc2626', cx - 3, cy + 6, 2, 3); px(g, '#dc2626', cx + 2, cy + 6, 2, 3);
}

function drawFixed(g, o) {
  const bx = o.x * T, by = o.y * T;
  switch (o.kind) {
    case 'plant':
      px(g, '#9a3412', bx + 4, by + 10, 8, 6); px(g, '#c2410c', bx + 4, by + 10, 8, 2);
      px(g, '#2f7a3f', bx + 3, by + 2, 5, 8); px(g, '#4caf63', bx + 7, by, 5, 10); px(g, '#3f8f4f', bx + 9, by + 4, 4, 6);
      break;
    case 'poinsettia': // flor de Nochebuena
      px(g, '#d4a017', bx + 4, by + 11, 8, 5); px(g, '#f1c40f', bx + 4, by + 11, 8, 1);
      px(g, '#166534', bx + 2, by + 7, 12, 4);
      px(g, '#dc2626', bx + 6, by, 4, 5); px(g, '#dc2626', bx + 1, by + 4, 5, 4); px(g, '#dc2626', bx + 10, by + 4, 5, 4); px(g, '#dc2626', bx + 4, by + 7, 3, 3); px(g, '#dc2626', bx + 9, by + 7, 3, 3);
      px(g, '#b91c1c', bx + 5, by + 4, 6, 4); px(g, '#fde047', bx + 7, by + 5, 2, 2);
      break;
    case 'snowman':
      px(g, '#000', bx + 3, by + 15, 10, 1);
      px(g, '#f8fafc', bx + 3, by + 8, 10, 7); px(g, '#e2e8f0', bx + 3, by + 13, 10, 2);
      px(g, '#f8fafc', bx + 5, by + 2, 6, 6);
      px(g, '#111827', bx + 4, by - 2, 8, 1); px(g, '#111827', bx + 5, by - 6, 6, 4);
      px(g, '#dc2626', bx + 4, by + 7, 8, 2); px(g, '#dc2626', bx + 10, by + 8, 2, 4);
      px(g, '#111827', bx + 6, by + 4, 1, 1); px(g, '#111827', bx + 9, by + 4, 1, 1); px(g, '#f97316', bx + 8, by + 5, 3, 1);
      px(g, '#111827', bx + 8, by + 10, 1, 1); px(g, '#111827', bx + 8, by + 12, 1, 1);
      px(g, '#7c4a2d', bx + 1, by + 9, 3, 1); px(g, '#7c4a2d', bx + 12, by + 9, 3, 1);
      break;
    case 'board': {
      px(g, '#f8fafc', bx + 2, by + 4, o.w * T - 4, 11); px(g, '#94a3b8', bx + 1, by + 3, o.w * T - 2, 1);
      px(g, '#64748b', bx + 1, by + 15, o.w * T - 2, 1);
      px(g, '#ef4444', bx + 6, by + 6, 14, 1); px(g, '#2563eb', bx + 6, by + 8, 22, 1); px(g, '#16a34a', bx + 6, by + 10, 10, 1);
      break;
    }
    case 'cabinet':
      px(g, '#64748b', bx + 2, by, 12, 16); px(g, '#94a3b8', bx + 3, by + 1, 10, 4); px(g, '#94a3b8', bx + 3, by + 6, 10, 4); px(g, '#94a3b8', bx + 3, by + 11, 10, 4);
      px(g, '#334155', bx + 7, by + 2, 2, 1); px(g, '#334155', bx + 7, by + 7, 2, 1); px(g, '#334155', bx + 7, by + 12, 2, 1);
      break;
    case 'mail':
      px(g, '#334155', bx + 7, by + 9, 2, 7); px(g, '#2563eb', bx + 2, by + 2, 12, 8); px(g, '#1d4ed8', bx + 2, by + 8, 12, 2);
      px(g, '#f8fafc', bx + 4, by + 4, 6, 1); px(g, '#ef4444', bx + 12, by, 2, 6); px(g, '#ef4444', bx + 12, by, 4, 2);
      break;
    case 'mega':
      px(g, '#7c4a2d', bx + 1, by + 9, 14, 3); px(g, '#5b3520', bx + 2, by + 12, 2, 4); px(g, '#5b3520', bx + 12, by + 12, 2, 4);
      px(g, '#f97316', bx + 4, by + 3, 4, 5); px(g, '#fb923c', bx + 8, by + 1, 5, 9); px(g, '#334155', bx + 2, by + 4, 2, 3);
      break;
    case 'reception':
      px(g, '#7c4a2d', bx, by + T + 2, o.w * T, 12); px(g, '#a8714c', bx, by + T, o.w * T, 4); px(g, '#5b3520', bx, by + 2 * T - 2, o.w * T, 2);
      px(g, '#fde68a', bx + o.w * T / 2 - 12, by + T + 5, 24, 5); px(g, '#7c4a2d', bx + o.w * T / 2 - 11, by + T + 6, 22, 3);
      break;
    case 'directory':
      px(g, '#1e1b4b', bx + 2, by + 3, o.w * T - 4, 12); px(g, '#fbbf24', bx + 2, by + 3, o.w * T - 4, 2);
      for (let k = 0; k < 4; k++) px(g, '#c7d2fe', bx + 6, by + 7 + k * 2, 30 + ((k * 13) % 40), 1);
      break;
    case 'sofa':
      px(g, '#6d28d9', bx, by + 4, o.w * T, 12); px(g, '#8b5cf6', bx + 2, by + 6, o.w * T - 4, 6); px(g, '#5b21b6', bx, by + 4, 3, 12); px(g, '#5b21b6', bx + o.w * T - 3, by + 4, 3, 12);
      break;
    case 'cooler':
      px(g, '#e2e8f0', bx + 4, by + 6, 8, 10); px(g, '#7dd3fc', bx + 5, by, 6, 7); px(g, '#38bdf8', bx + 5, by + 4, 6, 3); px(g, '#ef4444', bx + 6, by + 9, 2, 2);
      break;
    default: break;
  }
}

/* ------------------------------------------------------------------ */
/* Personajes y escritorios (capa animada)                              */
/* ------------------------------------------------------------------ */

function drawDesk(o, time) {
  const t = threadById.get(o.thread);
  if (!t) return;
  const st = STATUS[t.status] || STATUS.dormido;
  const seed = hash(t.id);
  const shirt = SHIRTS[seed % SHIRTS.length], skin = SKINS[(seed >> 3) % SKINS.length], hair = HAIRS[(seed >> 6) % HAIRS.length];
  const bx = o.x * T, by = o.y * T; // fila de la silla
  const dy = by + T;                 // fila del escritorio
  const frame = Math.floor(time / 180) % 2;
  // Silla
  px(ctx, '#2d2a3e', bx + 2, by + 3, 12, 13); px(ctx, '#3f3a57', bx + 3, by + 4, 10, 5);
  const present = t.status === 'trabajando' || t.status === 'espera' || t.status === 'hoy';
  if (present) {
    // Aviso reciente (avisos.js): salta y levanta la mano unos segundos
    const fx = typeof avisoFx === 'function' ? avisoFx(t.id, time) : null;
    const wy = by - (fx ? fx.hop : 0);
    const bob = fx ? 0 : t.status === 'trabajando' ? frame : t.status === 'espera' ? Math.round(Math.sin(time / 300)) : 0;
    px(ctx, shirt, bx + 3, wy + 9, 10, 8);
    px(ctx, skin, bx + 4, wy + 1 + bob, 8, 7);
    px(ctx, hair, bx + 4, wy + bob, 8, 3); px(ctx, hair, bx + 3, wy + 1 + bob, 1, 4); px(ctx, hair, bx + 12, wy + 1 + bob, 1, 3);
    px(ctx, '#1f2937', bx + 6, wy + 5 + bob, 1, 1); px(ctx, '#1f2937', bx + 9, wy + 5 + bob, 1, 1);
    px(ctx, '#f4a3a3', bx + 5, wy + 6 + bob, 1, 1); px(ctx, '#f4a3a3', bx + 10, wy + 6 + bob, 1, 1); // mejillas
    if (fx) {
      px(ctx, shirt, bx + 13, wy + 4, 2, 6); px(ctx, skin, bx + 13, wy + 1, 3, 3); // mano arriba
      if (fx.both) { px(ctx, shirt, bx + 1, wy + 4, 2, 6); px(ctx, skin, bx, wy + 1, 3, 3); }
      else px(ctx, skin, bx + 2, wy + 13, 3, 3);
    } else if (t.status === 'trabajando') {
      px(ctx, skin, bx + 2, by + 13 + frame, 3, 3); px(ctx, skin, bx + 11, by + 14 - frame, 3, 3);
    } else {
      px(ctx, skin, bx + 2, by + 13, 3, 3); px(ctx, skin, bx + 11, by + 13, 3, 3);
    }
    if (XMAS) holidayHat(bx, wy + bob, seed % 3 === 0);
  } else if (t.status === 'dormido') {
    px(ctx, shirt, bx + 3, by + 11, 10, 6);
    px(ctx, hair, bx + 4, by + 9, 8, 6); px(ctx, skin, bx + 5, by + 13, 6, 3);
    if (XMAS) holidayHat(bx, by + 8, seed % 3 === 0);
  }
  // Sombra y escritorio
  ctx.globalAlpha = .18; px(ctx, '#000', bx + 1, dy + 15, 30, 2); ctx.globalAlpha = 1;
  px(ctx, '#a8714c', bx, dy + 1, 32, 6); px(ctx, '#c08457', bx, dy + 1, 32, 1);
  px(ctx, '#7c4a2d', bx + 1, dy + 7, 30, 8); px(ctx, '#5b3520', bx + 1, dy + 14, 30, 1);
  px(ctx, '#94a3b8', bx + 4, dy + 2, 9, 2);
  if (t.status === 'semana') { px(ctx, '#f8fafc', bx + 6, dy - 1, 4, 4); px(ctx, '#78350f', bx + 7, dy, 2, 2); }
  if (XMAS && t.total && t.done === t.total) { // regalo para los hilos que terminaron su lista
    px(ctx, '#dc2626', bx + 1, dy - 3, 7, 6); px(ctx, '#ffd166', bx + 4, dy - 3, 1, 6); px(ctx, '#ffd166', bx + 1, dy, 7, 1);
    px(ctx, '#ffd166', bx + 2, dy - 5, 2, 2); px(ctx, '#ffd166', bx + 5, dy - 5, 2, 2);
  } else if (XMAS && seed % 2) { // taza de chocolate
    px(ctx, '#f8fafc', bx + 3, dy - 1, 4, 3); px(ctx, '#7c2d12', bx + 3, dy - 1, 4, 1); px(ctx, '#f8fafc', bx + 7, dy, 1, 1);
  }
  // Avance en el frente del escritorio
  if (t.total) {
    px(ctx, '#3b2416', bx + 4, dy + 10, 24, 3);
    px(ctx, t.done === t.total ? '#4ade80' : '#facc15', bx + 4, dy + 10, Math.max(1, Math.round((24 * t.done) / t.total)), 3);
  }
  // Monitor
  px(ctx, '#111827', bx + 17, by + 5, 13, 10); px(ctx, '#111827', bx + 22, by + 15, 3, 3);
  px(ctx, st.screen, bx + 18, by + 6, 11, 8);
  if (t.status === 'trabajando') {
    const off = Math.floor(time / 150) % 4;
    for (let k = 0; k < 3; k++) px(ctx, '#052e16', bx + 19, by + 7 + ((k * 2 + off) % 7), 3 + ((k * 5 + off * 3) % 7), 1);
  }
  // Globos
  if (t.status === 'trabajando') {
    px(ctx, '#ffffff', bx + 1, by - 9, 15, 7); px(ctx, '#ffffff', bx + 3, by - 2, 2, 2);
    for (let k = 0; k < 3; k++) px(ctx, (Math.floor(time / 250) % 3) === k ? '#16a34a' : '#bbf7d0', bx + 3 + k * 4, by - 7, 3, 3);
  } else if (t.status === 'espera') {
    const up = Math.round(Math.abs(Math.sin(time / 260)) * 3);
    px(ctx, '#f97316', bx + 3, by - 13 - up, 10, 11); px(ctx, '#f97316', bx + 6, by - 2 - up, 3, 2);
    px(ctx, '#fff', bx + 7, by - 11 - up, 2, 5); px(ctx, '#fff', bx + 7, by - 5 - up, 2, 2);
  } else if (t.status === 'dormido') {
    const k = (time / 900) % 1;
    ctx.globalAlpha = 1 - k;
    drawZ(bx + 10 + k * 4, by + 4 - k * 10);
    ctx.globalAlpha = 1;
  }
}
/** Gorro de Santa (rojo) o de duende (verde) sobre una cabeza dibujada en (bx, by). */
function holidayHat(bx, by, elf) {
  const main = elf ? '#16a34a' : '#dc2626';
  const dark = elf ? '#15803d' : '#b91c1c';
  px(ctx, main, bx + 4, by - 3, 8, 3); px(ctx, main, bx + 6, by - 5, 6, 2); px(ctx, dark, bx + 10, by - 6, 3, 2);
  px(ctx, '#f8fafc', bx + 3, by - 1, 10, 2);
  px(ctx, elf ? '#facc15' : '#f8fafc', bx + 12, by - 7, 3, 3);
}

function drawTree(o, time, big) {
  if (big) {
    const cx = (o.x + 1) * T, base = (o.y + 2) * T;
    ctx.globalAlpha = .22; px(ctx, '#000', cx - 15, base - 2, 30, 3); ctx.globalAlpha = 1;
    px(ctx, '#7c4a2d', cx - 2, base - 7, 4, 5); px(ctx, '#991b1b', cx - 7, base - 4, 14, 4); px(ctx, '#ffd166', cx - 7, base - 4, 14, 1);
    const tiers = [[base - 7, 30, 12], [base - 17, 24, 11], [base - 26, 17, 10], [base - 34, 10, 9]];
    for (const [ty, w, h] of tiers) {
      for (let r = 0; r < h; r++) {
        const ww = Math.round(w * (r + 1) / h);
        px(ctx, r % 3 === 0 ? '#15803d' : '#166534', cx - Math.floor(ww / 2), ty - h + r, ww, 1);
      }
    }
    // Guirnalda dorada
    for (let k = 0; k < 9; k++) px(ctx, '#fde68a', cx - 10 + k * 2, base - 12 - Math.round(k * 0.6), 1, 1);
    for (let k = 0; k < 7; k++) px(ctx, '#fde68a', cx + 7 - k * 2, base - 22 - Math.round(k * 0.5), 1, 1);
    // Luces
    const spots = [[-9, -10], [6, -12], [-3, -14], [10, -9], [-6, -20], [5, -21], [0, -24], [-4, -29], [3, -30], [-11, -9], [1, -16], [-1, -36]];
    spots.forEach(([dx, dy], i) => {
      const on = (Math.floor(time / 380) + i) % 3 !== 0;
      px(ctx, on ? LIGHTS[i % LIGHTS.length] : '#3f3f46', cx + dx, base + dy, 2, 2);
    });
    // Estrella
    const glow = 0.6 + 0.4 * Math.sin(time / 300);
    ctx.globalAlpha = glow * 0.45; px(ctx, '#fde68a', cx - 5, base - 50, 10, 10); ctx.globalAlpha = 1;
    px(ctx, '#ffd166', cx - 2, base - 48, 4, 6); px(ctx, '#ffd166', cx - 4, base - 46, 8, 2); px(ctx, '#fff7cc', cx - 1, base - 47, 2, 2);
    // Regalos
    px(ctx, '#dc2626', cx - 16, base - 6, 8, 6); px(ctx, '#ffd166', cx - 13, base - 6, 2, 6); px(ctx, '#ffd166', cx - 16, base - 4, 8, 1);
    px(ctx, '#2563eb', cx + 8, base - 7, 9, 7); px(ctx, '#f8fafc', cx + 12, base - 7, 1, 7); px(ctx, '#f8fafc', cx + 8, base - 4, 9, 1);
    px(ctx, '#16a34a', cx - 5, base + 1, 7, 5); px(ctx, '#dc2626', cx - 2, base + 1, 1, 5); px(ctx, '#ffd166', cx - 3, base - 1, 3, 2);
  } else {
    const bx = o.x * T, by = o.y * T;
    px(ctx, '#7c4a2d', bx + 7, by + 12, 2, 3); px(ctx, '#991b1b', bx + 4, by + 13, 8, 3);
    for (let r = 0; r < 8; r++) { const w = 4 + r * 1.5; px(ctx, '#166534', bx + 8 - w / 2, by + 5 + r, w, 1); }
    for (let r = 0; r < 6; r++) { const w = 2 + r * 1.5; px(ctx, '#15803d', bx + 8 - w / 2, by - 1 + r, w, 1); }
    [[5, 9], [10, 10], [8, 5], [6, 2]].forEach(([dx, dy], i) => {
      px(ctx, (Math.floor(time / 420) + i) % 2 ? LIGHTS[(i + o.x) % LIGHTS.length] : '#3f3f46', bx + dx, by + dy, 1, 1);
    });
    px(ctx, '#ffd166', bx + 7, by - 3, 2, 2);
  }
}

/** Luces de colores colgando de las guirnaldas de los muros. */
function drawLights(time, viewW, viewH) {
  if (!XMAS || !map.faces) return;
  const blink = Math.floor(time / 450);
  for (const f of map.faces) {
    const bx = f.x * T, by = f.y * T;
    if (bx < cam.x - T || bx > cam.x + viewW || by < cam.y - T || by > cam.y + viewH) continue;
    for (const k of [3, 11]) {
      const i = f.x * 2 + (k > 8 ? 1 : 0) + f.y;
      const on = (blink + i) % 4 !== 0;
      const ly = by + 9 + Math.round(2 * Math.sin((Math.PI * k) / T));
      px(ctx, '#14532d', bx + k, ly - 1, 1, 1);
      if (on) { ctx.globalAlpha = .35; px(ctx, LIGHTS[i % LIGHTS.length], bx + k - 1, ly - 1, 4, 4); ctx.globalAlpha = 1; }
      px(ctx, on ? LIGHTS[i % LIGHTS.length] : '#475569', bx + k, ly, 2, 2);
    }
  }
}

function drawZ(x, y) { px(ctx, '#cbd5e1', x, y, 4, 1); px(ctx, '#cbd5e1', x + 2, y + 1, 1, 1); px(ctx, '#cbd5e1', x + 1, y + 2, 1, 1); px(ctx, '#cbd5e1', x, y + 3, 4, 1); }

function drawBoardProgress(o) {
  const p = projectByKey.get(map.rooms[o.room]?.key);
  if (!p) return;
  let done = 0, total = 0;
  for (const t of p.threads) if (t.status !== 'dormido') { done += t.done; total += t.total; }
  const w = o.w * T - 12;
  px(ctx, '#e2e8f0', o.x * T + 6, o.y * T + 12, w, 2);
  if (total) px(ctx, '#16a34a', o.x * T + 6, o.y * T + 12, Math.round((w * done) / total), 2);
}

function drawReceptionist(o, time) {
  const bx = (o.x + 1) * T + 8, by = o.y * T;
  const waiting = allThreads().filter(t => t.status === 'espera').length;
  px(ctx, '#2d2a3e', bx + 2, by + 3, 12, 13);
  px(ctx, '#0ea5e9', bx + 3, by + 9, 10, 8);
  px(ctx, '#e0ac69', bx + 4, by + 1, 8, 7); px(ctx, '#151515', bx + 4, by, 8, 3); px(ctx, '#151515', bx + 3, by + 1, 1, 6); px(ctx, '#151515', bx + 12, by + 1, 1, 6);
  px(ctx, '#1f2937', bx + 6, by + 5, 1, 1); px(ctx, '#1f2937', bx + 9, by + 5, 1, 1);
  px(ctx, '#111827', bx + 2, by + 3, 1, 4); px(ctx, '#111827', bx + 2, by + 6, 3, 1); // diadema
  px(ctx, '#f4a3a3', bx + 5, by + 6, 1, 1); px(ctx, '#f4a3a3', bx + 10, by + 6, 1, 1);
  if (XMAS) holidayHat(bx, by, false);
  if (waiting) {
    const up = Math.round(Math.abs(Math.sin(time / 260)) * 3);
    px(ctx, '#f97316', bx + 3, by - 13 - up, 10, 11);
    px(ctx, '#fff', bx + 7, by - 11 - up, 2, 5); px(ctx, '#fff', bx + 7, by - 5 - up, 2, 2);
  }
}

/** Santa: traje rojo, cinturón con hebilla dorada, barba blanca y gorro con pompón. */
function drawSanta(x, y, step) {
  const RED = '#dc2626', DARK = '#991b1b', WHITE = '#f8fafc', SKIN = '#ffd6b0';
  const d = player.dir;
  // Saco de regalos en la espalda (se ve cuando camina hacia arriba o de lado)
  if (d === 'up') { px(ctx, '#8b5a2b', x + 2, y + 3, 12, 8); px(ctx, '#6b4423', x + 2, y + 3, 12, 2); px(ctx, '#ffd166', x + 7, y + 2, 2, 2); }
  if (d === 'left') { px(ctx, '#8b5a2b', x + 11, y + 4, 5, 7); px(ctx, '#6b4423', x + 11, y + 4, 5, 1); }
  if (d === 'right') { px(ctx, '#8b5a2b', x, y + 4, 5, 7); px(ctx, '#6b4423', x, y + 4, 5, 1); }
  // Botas y piernas
  px(ctx, DARK, x + 5, y + 11, 2, 3 - step); px(ctx, DARK, x + 9, y + 11, 2, 2 + step);
  px(ctx, '#111827', x + 4, y + 14 - step, 4, 2); px(ctx, '#111827', x + 8, y + 13 + step, 4, 2);
  // Traje
  px(ctx, RED, x + 2, y + 6, 12, 6); px(ctx, DARK, x + 2, y + 11, 12, 1);
  px(ctx, WHITE, x + 2, y + 11, 12, 1);
  px(ctx, '#111827', x + 2, y + 9, 12, 2); px(ctx, '#ffd166', x + 7, y + 9, 2, 2);
  if (d !== 'up') px(ctx, WHITE, x + 7, y + 6, 2, 3);
  // Brazos y guantes
  px(ctx, RED, x + 1, y + 7, 2, 4); px(ctx, RED, x + 13, y + 7, 2, 4);
  px(ctx, '#111827', x + 1, y + 10, 2, 2); px(ctx, '#111827', x + 13, y + 10, 2, 2);
  // Cara, barba y gorro
  if (d === 'up') {
    px(ctx, WHITE, x + 4, y + 1, 8, 6);
  } else {
    px(ctx, SKIN, x + 4, y + 1, 8, 5);
    px(ctx, WHITE, x + 3, y + 4, 10, 4); px(ctx, WHITE, x + 5, y + 8, 6, 1);
    px(ctx, '#f9a8a8', x + 4, y + 4, 1, 1); px(ctx, '#f9a8a8', x + 11, y + 4, 1, 1);
    if (d === 'down') { px(ctx, '#1f2937', x + 6, y + 3, 1, 1); px(ctx, '#1f2937', x + 9, y + 3, 1, 1); px(ctx, '#f08080', x + 7, y + 4, 2, 1); }
    if (d === 'left') { px(ctx, '#1f2937', x + 5, y + 3, 1, 1); px(ctx, '#f08080', x + 4, y + 4, 2, 1); }
    if (d === 'right') { px(ctx, '#1f2937', x + 10, y + 3, 1, 1); px(ctx, '#f08080', x + 10, y + 4, 2, 1); }
  }
  px(ctx, RED, x + 4, y - 3, 8, 3); px(ctx, RED, x + 6, y - 5, 5, 2);
  const tip = d === 'left' ? -1 : 1;
  px(ctx, DARK, x + (tip > 0 ? 10 : 3), y - 6, 3, 2);
  px(ctx, WHITE, x + (tip > 0 ? 12 : 1), y - 7, 3, 3);
  px(ctx, WHITE, x + 3, y, 10, 2);
}

function drawPlayer(time) {
  const x = (player.fx + (player.tx - player.fx) * player.t) * T;
  const y = (player.fy + (player.ty - player.fy) * player.t) * T;
  const moving = player.t < 1;
  const step = moving ? Math.floor(time / 120) % 2 : 0;
  ctx.globalAlpha = .25; px(ctx, '#000', x + 3, y + 14, 10, 2); ctx.globalAlpha = 1;
  if (XMAS) { drawSanta(x, y - (moving ? step : 0), step); return; }
  // Piernas
  px(ctx, '#1e293b', x + 5, y + 11, 2, 4 - step); px(ctx, '#1e293b', x + 9, y + 11, 2, 3 + step);
  // Cuerpo
  px(ctx, '#ff4d6d', x + 3, y + 6, 10, 6); px(ctx, '#e11d48', x + 3, y + 10, 10, 2);
  // Cabeza
  px(ctx, '#ffdbac', x + 4, y, 8, 7);
  px(ctx, '#ffd166', x + 3, y - 1, 10, 3); px(ctx, '#f59e0b', x + 3, y + 1, 10, 1);
  if (player.dir === 'down') { px(ctx, '#1f2937', x + 6, y + 4, 1, 1); px(ctx, '#1f2937', x + 9, y + 4, 1, 1); px(ctx, '#f59e0b', x + 4, y + 2, 8, 1); }
  if (player.dir === 'left') { px(ctx, '#1f2937', x + 5, y + 4, 1, 1); px(ctx, '#f59e0b', x + 1, y + 1, 3, 1); }
  if (player.dir === 'right') { px(ctx, '#1f2937', x + 10, y + 4, 1, 1); px(ctx, '#f59e0b', x + 12, y + 1, 3, 1); }
}

/* ------------------------------------------------------------------ */
/* Texto en pantalla (nítido, fuera de la escala de píxeles)            */
/* ------------------------------------------------------------------ */

function screenXY(wx, wy) { return [Math.round((wx - cam.x) * SCALE), Math.round((wy - cam.y) * SCALE)]; }
function label(text, wx, wy, { color = '#fff', size = 7, bg = 'rgba(15,12,34,.85)', font = 'VT323', bold = false } = {}) {
  const [sx, sy] = screenXY(wx, wy);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${bold ? '700 ' : ''}${Math.round(size * SCALE)}px "${font}", monospace`;
  const w = ctx.measureText(text).width;
  const h = Math.round(size * SCALE);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(sx - w / 2 - 6, sy - h + 1, w + 12, h + 3, Math.round(h / 3));
    else ctx.rect(sx - w / 2 - 6, sy - h + 1, w + 12, h + 3);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, sx, sy);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Bucle principal                                                      */
/* ------------------------------------------------------------------ */

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  SCALE = Math.max(2, Math.min(5, Math.floor(Math.min(canvas.width / (18 * T), canvas.height / (13 * T)))));
}
addEventListener('resize', resize);
resize();

function update(dt) {
  if (!map) return;
  if (XMAS) for (const f of flakes) { f.y += f.v * dt * (f.r === 2 ? 1.4 : 1); if (f.y > 1) { f.y = -0.02; f.x = Math.random(); } }
  if (player.t < 1) {
    player.t = Math.min(1, player.t + dt * 6.5);
    if (player.t >= 1) { player.fx = player.tx; player.fy = player.ty; }
  }
  if (player.t >= 1) {
    let next = null;
    if (player.path.length) {
      next = player.path.shift();
    } else if (!modalOpen) {
      const d = heldDir();
      if (d) { next = { x: player.tx + d[0], y: player.ty + d[1] }; player.dir = d[2]; player.onArrive = null; }
    }
    if (next) {
      if (next.x !== player.tx) player.dir = next.x > player.tx ? 'right' : 'left';
      else if (next.y !== player.ty) player.dir = next.y > player.ty ? 'down' : 'up';
      if (walkable(next.x, next.y)) {
        player.fx = player.tx; player.fy = player.ty; player.tx = next.x; player.ty = next.y; player.t = 0;
      } else { player.path = []; }
    } else if (player.onArrive) {
      const f = player.onArrive; player.onArrive = null; f();
    }
  }
  const r = roomAt(player.tx, player.ty);
  if (r !== currentRoom) { currentRoom = r; onEnterRoom(r); }

  const viewW = canvas.width / SCALE, viewH = canvas.height / SCALE;
  const pxw = (player.fx + (player.tx - player.fx) * player.t) * T + 8;
  const pyw = (player.fy + (player.ty - player.fy) * player.t) * T + 8;
  const ww = map.W * T, wh = map.H * T;
  const dpr = canvas.width / innerWidth;
  const hudBase = ((hudEl.getBoundingClientRect().bottom + 6) * dpr) / SCALE; // la barra de arriba no tapa el mapa
  const freeH = viewH - hudBase;
  const tx = ww <= viewW ? (ww - viewW) / 2 : Math.max(0, Math.min(ww - viewW, pxw - viewW / 2));
  const ty = wh <= freeH ? (wh - freeH) / 2 - hudBase : Math.max(-hudBase, Math.min(wh - viewH + 24, pyw - hudBase - freeH / 2));
  const k = snapCam ? 1 : Math.min(1, dt * 8);
  snapCam = false;
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
}

function render(time) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!map || !staticLayer) return;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(SCALE, 0, 0, SCALE, -Math.round(cam.x * SCALE), -Math.round(cam.y * SCALE));
  ctx.drawImage(staticLayer, 0, 0);

  const viewW = canvas.width / SCALE, viewH = canvas.height / SCALE;
  const visible = o => (o.x + o.w) * T > cam.x - T && o.x * T < cam.x + viewW + T && (o.y + o.h) * T > cam.y - 2 * T && o.y * T < cam.y + viewH + T;
  // Orden por profundidad: lo de más abajo se dibuja encima
  drawLights(time, viewW, viewH);
  const DYNAMIC = new Set(['desk', 'reception', 'board', 'xtree', 'minitree']);
  const items = map.objects.filter(o => DYNAMIC.has(o.kind) && visible(o));
  const py = player.fy + (player.ty - player.fy) * player.t;
  let playerDrawn = false;
  items.sort((a, b) => (a.y + a.h) - (b.y + b.h));
  for (const o of items) {
    if (!playerDrawn && py + 1 <= o.y + o.h - 0.01 && o.kind !== 'board') { drawPlayer(time); playerDrawn = true; }
    if (o.kind === 'desk') drawDesk(o, time);
    else if (o.kind === 'reception') drawReceptionist(o, time);
    else if (o.kind === 'board') drawBoardProgress(o);
    else if (o.kind === 'xtree') drawTree(o, time, true);
    else if (o.kind === 'minitree') drawTree(o, time, false);
  }
  if (!playerDrawn) drawPlayer(time);

  // Brillo dorado sobre lo que señalas o tienes al lado
  const glowObj = hover || nearbyObject();
  if (glowObj) {
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(time / 220);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1;
    const top = glowObj.kind === 'desk' ? glowObj.y * T - 2 : glowObj.y * T - 1;
    ctx.strokeRect(glowObj.x * T - 1.5, top - 0.5, glowObj.w * T + 3, (glowObj.y + glowObj.h) * T - top + 2);
    ctx.globalAlpha = 1;
  }

  // Nieve cayendo
  if (XMAS) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    const s = Math.max(1, Math.round(SCALE * 0.7));
    for (const f of flakes) {
      ctx.globalAlpha = f.r === 2 ? 0.9 : 0.55;
      const fx = ((f.x + Math.sin(time / 1400 + f.p) * 0.01) % 1) * canvas.width;
      ctx.fillRect(Math.round(fx), Math.round(f.y * canvas.height), s * f.r, s * f.r);
    }
    ctx.restore();
  }

  // Letreros de cada oficina en el pasillo
  for (const r of map.rooms) {
    const p = projectByKey.get(r.key);
    if (!p) continue;
    const working = p.threads.filter(t => t.status === 'trabajando').length;
    const waiting = p.threads.filter(t => t.status === 'espera').length;
    const lamp = working ? '🟢' : waiting ? '🟠' : '⚪';
    const sy = r.top ? (r.doorY + 1) * T + 3 : r.doorY * T - 2;
    label(`${lamp} ${cut(r.name, 22)}${waiting ? `  🔔${waiting}` : ''}`, (r.x0 + 8) * T, r.top ? sy + 10 : sy, { color: '#fff', size: 8, bg: shade(r.accent, -0.35) });
  }
  label(XMAS ? '🎅 Recepción' : '🛎️ Recepción', 6 * T, 9.6 * T, { size: 7, color: '#fde68a' });
  if (XMAS && currentRoom === -10) label('🎄 ¡Feliz Navidad!', 10 * T, 9.9 * T, { size: 7, color: '#fff', bg: 'rgba(153,27,27,.9)' });
  label('🗺️ Directorio', 6 * T, 7.9 * T, { size: 6, color: '#c7d2fe' });

  // Nombres de los hilos de la oficina donde estás
  if (currentRoom >= 0) {
    for (const o of map.objects) {
      if (o.room !== currentRoom || !visible(o)) continue;
      if (o.kind === 'desk') {
        const t = threadById.get(o.thread);
        if (t) {
          const focus = hover === o || nearbyObject() === o;
          const lift = (t.status === 'espera' ? 16 : t.status === 'trabajando' ? 11 : 2) + (XMAS ? (t.status === 'espera' || t.status === 'trabajando' ? 3 : 8) : 0);
          label(cut(t.title, focus ? 40 : 13), (o.x + 1) * T, o.y * T - lift, { size: 6, color: focus ? '#ffd166' : '#fff' });
        }
      } else if (o.kind === 'board') label('📋 Pizarra', (o.x + 2) * T, o.y * T + 11, { size: 6, color: '#1e1b4b', bg: 'rgba(255,209,102,.95)' });
      else if (o.kind === 'cabinet' && o.count) label(`🗄️ ${o.count}`, (o.x + 0.5) * T, (o.y + 1) * T + 9, { size: 6 });
      else if (o.kind === 'mail') label('➕ Nuevo', (o.x + 0.5) * T, o.y * T, { size: 6, color: '#93c5fd' });
      else if (o.kind === 'mega') label('📣 Avance', (o.x + 0.5) * T, o.y * T, { size: 6, color: '#fdba74' });
    }
  }

  // Ayuda para interactuar
  const near = nearbyObject();
  if (near && !modalOpen) {
    label(`[E] ${verbFor(near)}`, (near.x + near.w / 2) * T, (near.y + near.h) * T + 13, { size: 7, color: '#ffd166', bg: 'rgba(124,58,18,.92)' });
  }
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  render(now);
  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ */
/* Movimiento, clics e interacción                                      */
/* ------------------------------------------------------------------ */

const DIRS = { ArrowUp: [0, -1, 'up'], KeyW: [0, -1, 'up'], ArrowDown: [0, 1, 'down'], KeyS: [0, 1, 'down'], ArrowLeft: [-1, 0, 'left'], KeyA: [-1, 0, 'left'], ArrowRight: [1, 0, 'right'], KeyD: [1, 0, 'right'] };
function heldDir() { for (const k of [...keys].reverse()) if (DIRS[k]) return DIRS[k]; return null; }

function bfs(sx, sy, goals) {
  const key = (x, y) => y * map.W + x;
  const goalSet = new Set(goals.map(g => key(g.x, g.y)));
  if (goalSet.has(key(sx, sy))) return [];
  const prev = new Map([[key(sx, sy), -1]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k) || !walkable(nx, ny)) continue;
      prev.set(k, key(x, y));
      if (goalSet.has(k)) {
        const path = [];
        let c = k;
        while (c !== key(sx, sy)) { path.unshift({ x: c % map.W, y: Math.floor(c / map.W) }); c = prev.get(c); }
        return path;
      }
      q.push([nx, ny]);
    }
  }
  return null;
}

function standSpots(o) {
  const spots = [];
  for (let x = o.x - 1; x <= o.x + o.w; x++) for (let y = o.y - 1; y <= o.y + o.h; y++) {
    const inside = x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h;
    const corner = (x === o.x - 1 || x === o.x + o.w) && (y === o.y - 1 || y === o.y + o.h);
    if (!inside && !corner && walkable(x, y)) spots.push({ x, y });
  }
  return spots;
}

const INTERACTIVE = new Set(['desk', 'board', 'cabinet', 'mail', 'mega', 'reception', 'directory']);
function nearbyObject() {
  if (!map || player.t < 1) return null;
  const order = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const f = order[player.dir];
  const facing = map.objAt.get(`${player.tx + f[0]},${player.ty + f[1]}`);
  if (facing && INTERACTIVE.has(facing.kind)) return facing;
  for (const [dx, dy] of Object.values(order)) {
    const o = map.objAt.get(`${player.tx + dx},${player.ty + dy}`);
    if (o && INTERACTIVE.has(o.kind)) return o;
  }
  return null;
}
function verbFor(o) {
  return { desk: 'Ver escritorio', board: 'Ver pizarra', cabinet: 'Abrir archivo', mail: 'Nuevo hilo', mega: 'Pedir avance', reception: 'Hablar con recepción', directory: 'Ver directorio' }[o.kind] || 'Interactuar';
}

function walkTo(o) {
  const spots = standSpots(o);
  const already = spots.some(s => s.x === player.tx && s.y === player.ty) && player.t >= 1;
  if (already) { faceTo(o); interact(o); return; }
  const path = bfs(player.tx, player.ty, spots);
  if (!path) { interact(o); return; }
  player.path = path;
  player.onArrive = () => { faceTo(o); interact(o); };
}
function faceTo(o) {
  const cx = o.x + (o.w - 1) / 2, cy = o.y + (o.h - 1) / 2;
  const dx = cx - player.tx, dy = cy - player.ty;
  player.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}
function teleport(x, y, dir = 'down') {
  snapCam = true;
  player.tx = player.fx = x; player.ty = player.fy = y; player.t = 1; player.path = []; player.onArrive = null; player.dir = dir;
}

function worldTileFromEvent(ev) {
  const r = canvas.getBoundingClientRect();
  const dpr = canvas.width / r.width;
  const wx = ((ev.clientX - r.left) * dpr) / SCALE + cam.x;
  const wy = ((ev.clientY - r.top) * dpr) / SCALE + cam.y;
  return { x: Math.floor(wx / T), y: Math.floor(wy / T) };
}
canvas.addEventListener('mousemove', ev => {
  if (!map) return;
  const { x, y } = worldTileFromEvent(ev);
  const o = map.objAt.get(`${x},${y}`);
  hover = o && INTERACTIVE.has(o.kind) ? o : null;
  canvas.style.cursor = hover ? 'pointer' : walkable(x, y) ? 'crosshair' : 'default';
});
canvas.addEventListener('click', ev => {
  if (!map || modalOpen) return;
  const { x, y } = worldTileFromEvent(ev);
  const o = map.objAt.get(`${x},${y}`);
  if (o && INTERACTIVE.has(o.kind)) { walkTo(o); return; }
  const path = walkable(x, y) ? bfs(player.tx, player.ty, [{ x, y }]) : null;
  if (path) { player.path = path; player.onArrive = null; }
});
addEventListener('keydown', ev => {
  if (modalOpen) { if (ev.key === 'Escape') closeModal(); return; }
  if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
  if (DIRS[ev.code]) { keys.add(ev.code); player.path = []; ev.preventDefault(); }
  if (ev.code === 'KeyE' || ev.code === 'Enter' || ev.code === 'Space') { const o = nearbyObject(); if (o) { interact(o); ev.preventDefault(); } }
  if (ev.code === 'KeyM') openGoto();
});
addEventListener('keyup', ev => keys.delete(ev.code));
addEventListener('blur', () => keys.clear());

function onEnterRoom(r) {
  const p = r >= 0 ? projectByKey.get(map.rooms[r]?.key) : null;
  $('#place').textContent = r >= 0 ? `📍 ${map.rooms[r].name}` : r === -10 ? '📍 Vestíbulo' : r === -20 ? '📍 Pasillo' : '📍 Oficina';
  if (p) {
    const w = p.threads.filter(t => t.status === 'trabajando').length;
    const q = p.threads.filter(t => t.status === 'espera').length;
    toast(`${XMAS ? '🎄 ' : ''}Entraste a ${p.name}: ${p.threads.length} hilos${w ? ` · ${w} trabajando` : ''}${q ? ` · ${q} te esperan` : ''}`, 'info', 2500);
  }
}

/* ------------------------------------------------------------------ */
/* Ventanas                                                             */
/* ------------------------------------------------------------------ */

function openModal(html, onMount) {
  const box = $('#modal');
  box.innerHTML = html;
  $('#modal-back').hidden = false;
  modalOpen = true;
  keys.clear();
  box.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
  if (onMount) onMount(box);
  const first = box.querySelector('textarea, .close');
  if (first) first.focus();
}
function closeModal() {
  if (premiumRec) { premiumRec.cancelar(); premiumRec = null; }
  $('#modal-back').hidden = true;
  $('#modal').innerHTML = '';
  modalOpen = false;
}
/** Avisa a los módulos (p. ej. voz-oficina.js) que se abrió una ventana, para que le agreguen sus botones. */
function avisarVentana(tipo, box, datos = {}) { document.dispatchEvent(new CustomEvent('oficina:ventana', { detail: { tipo, box, ...datos } })); }
$('#modal-back').addEventListener('mousedown', ev => { if (ev.target === ev.currentTarget) closeModal(); });

function allThreads() { return world ? world.projects.flatMap(p => p.threads.map(t => ({ ...t, project: p }))) : []; }

function interact(o) {
  if (o.kind === 'desk') return openDesk(o.thread);
  if (o.kind === 'board') return openBoard(map.rooms[o.room].key);
  if (o.kind === 'cabinet') return openCabinet(map.rooms[o.room].key);
  if (o.kind === 'mail') return openNewThread(map.rooms[o.room].key);
  if (o.kind === 'mega') return openBroadcast(map.rooms[o.room].key);
  if (o.kind === 'reception') return openReception();
  if (o.kind === 'directory') return openGoto();
}

function avatarCanvas(t) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  const seed = hash(t.id);
  px(g, SHIRTS[seed % SHIRTS.length], 3, 9, 10, 7);
  px(g, SKINS[(seed >> 3) % SKINS.length], 4, 2, 8, 7);
  px(g, HAIRS[(seed >> 6) % HAIRS.length], 4, 1, 8, 3); px(g, HAIRS[(seed >> 6) % HAIRS.length], 3, 2, 1, 4);
  px(g, '#1f2937', 6, 6, 1, 1); px(g, '#1f2937', 9, 6, 1, 1);
  return c;
}
function mountAvatar(box, t) {
  const slot = box.querySelector('.avatar-slot');
  if (slot) slot.replaceWith(avatarCanvas(t));
}

function statusTag(s) { return `<span class="status st-${s}">${esc(STATUS[s]?.label || s)}</span>`; }
function bar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="bigbar"><i style="width:${pct}%"></i><span>${total ? `${done}/${total} PASOS · ${pct}%` : 'SIN LISTA DE TAREAS'}</span></div>`;
}
function rich(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

/* ---- Voces premium (ElevenLabs, opcional: voz-elevenlabs.js) ---- */
const premium = () => window.VozElevenLabs || null;
const premiumOn = () => Boolean(premium() && premium().disponible());
let premiumRec = null; // grabación en curso del 🎙️ premium
const plainText = s => String(s || '').replace(/[`*_#>|]+/g, ' ').replace(/\s+/g, ' ').trim();
function shortText(s, n) {
  const t = plainText(s);
  if (t.length <= n) return t;
  const i = t.lastIndexOf(' ', n - 1);
  return `${t.slice(0, i > n / 2 ? i : n - 1)}…`;
}
/** Lo que cuenta un empleado al pulsar 🔊: su pregunta, en qué anda o su último resumen (corto, para cuidar créditos). */
function deskLine(t) {
  if (t.ask) return shortText(`¡Hola! Te tengo una pregunta: ${plainText(t.ask)}`, 220);
  if (t.status === 'trabajando' && t.current) return shortText(`¡Aquí ando, trabajando! Ahora estoy en: ${plainText(t.current)}`, 220);
  if (t.recap) return shortText(`¡Hola! Te cuento cómo voy: ${plainText(t.recap)}`, 220);
  if (t.status === 'dormido') return 'Zzz… ¡Ah, hola! Llevo días sin trabajo por aquí. Cuando quieras, me despiertas.';
  return shortText(`¡Hola! Soy el hilo «${plainText(t.title)}». Listo para lo que necesites.`, 160);
}
/** Un botón 🔊: el primer clic prepara y reproduce la voz; otro clic mientras tanto la calla. */
function bindSpeakButton(btn, getText, id) {
  if (!btn) return;
  const label = btn.textContent;
  let busy = false;
  btn.addEventListener('click', async () => {
    const v = premium();
    if (!v) return;
    if (busy) { v.callar(); return; }
    busy = true;
    btn.textContent = '⏹️ Callar';
    try { await v.hablar(getText(), { id }); } catch (e) { toast(`🔊 Voz premium: ${e.message}`, 'error', 6000); }
    finally { busy = false; btn.textContent = label; }
  });
}
/** El 🎙️ premium: graba hasta un minuto y ESCRIBE lo que dijiste en el cuadro. Nunca envía solo. */
function bindPremiumMic(btn, say) {
  if (!btn || !say) return;
  const label = btn.textContent;
  const reset = () => { premiumRec = null; btn.disabled = false; btn.textContent = label; btn.classList.remove('warn'); };
  btn.addEventListener('click', async () => {
    if (!premiumRec) {
      const rec = premium().grabarYTranscribir();
      premiumRec = rec;
      btn.textContent = '⏹️ Listo';
      btn.classList.add('warn');
      rec.listo.catch(e => { toast(`🎙️ ${e.message}`, 'error', 6000); if (premiumRec === rec) reset(); });
      return;
    }
    const rec = premiumRec;
    btn.disabled = true;
    btn.textContent = '⏳ Escribiendo…';
    try {
      const text = await rec.detener();
      if (text) { say.value = say.value.trim() ? `${say.value.trimEnd()} ${text}` : text; say.focus(); }
      else toast('🎙️ No entendí nada, prueba otra vez.', 'info');
    } catch (e) { toast(`🎙️ ${e.message}`, 'error', 6000); }
    finally { reset(); }
  });
}
function premiumHelpBox() {
  if (!premium()) return '';
  const on = premium().encendido();
  return `<div class="box premium-box"><h3>🎙️ VOCES PREMIUM (ELEVENLABS)</h3>
    <p>Opcional. Los empleados, la recepcionista y Santa hablan con voces de ElevenLabs: pulsa <b>🔊</b> en un escritorio o en la recepción. Cada frase nueva gasta créditos de tu cuenta de ElevenLabs (una corta ≈ 20) y las repetidas ya no se pagan. Necesita el panel Oficina abierto en Claude.</p>
    <div class="foot-row"><button class="pixel-btn${on ? ' primary' : ''}" data-premium-toggle aria-pressed="${on}">🎙️ Voces premium (ElevenLabs): ${on ? 'ENCENDIDAS' : 'APAGADAS'}</button>
    ${on ? `<button class="pixel-btn" data-premium-try>${XMAS ? '🎅 Probar con Santa' : '🛎️ Probar'}</button>` : ''}</div></div>`;
}
function bindPremiumHelp(box) {
  const slot = box.querySelector('.premium-slot');
  if (!slot || !premium()) return;
  slot.querySelector('[data-premium-toggle]')?.addEventListener('click', () => {
    premium().encender(!premium().encendido());
    toast(premium().encendido() ? '🎙️ Voces premium encendidas: pulsa 🔊 en un escritorio.' : '🎙️ Voces premium apagadas.', 'ok', 3500);
    slot.innerHTML = premiumHelpBox();
    bindPremiumHelp(box);
  });
  bindSpeakButton(slot.querySelector('[data-premium-try]'),
    () => (XMAS ? '¡Jo, jo, jo! ¡Feliz Navidad! Vamos a repartir órdenes por toda la oficina.' : '¡Hola! Bienvenido a tu oficina. Pasa por la recepción y te cuento quién te espera.'),
    XMAS ? 'santa' : 'recepcion');
}

/* ---- Escritorio de un hilo ---- */
async function openDesk(id) {
  const t = threadById.get(id);
  const p = t && world.projects.find(x => x.threads.some(y => y.id === id));
  if (!t || !p) return;
  let tab = 'resumen';
  let history = null;
  const render = box => {
    const body = box.querySelector('.modal-body');
    box.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'resumen') {
      body.innerHTML = `
        ${t.ask ? `<div class="box warnbox"><h3>🔔 TE PREGUNTA</h3>${rich(t.ask)}${t.delicate ? delicateNote() : ''}</div>` : ''}
        <div class="box"><h3>AVANCE</h3>${bar(t.done, t.total)}${t.current ? `<p style="margin:10px 0 0">▶ <b>Ahora:</b> ${rich(t.current)}</p>` : ''}</div>
        ${t.recap ? `<div class="box"><h3>📝 ÚLTIMO RESUMEN</h3>${rich(t.recap)}</div>` : ''}
        <div class="stats">
          <div class="stat"><b>${t.msgs}</b><span>mensajes tuyos</span></div>
          <div class="stat"><b>${t.tools}</b><span>acciones de Claude</span></div>
          <div class="stat"><b>${t.files}</b><span>archivos tocados</span></div>
          <div class="stat"><b>${esc(ago(t.created))}</b><span>empezó</span></div>
        </div>
        ${t.branch ? `<p class="note">🌿 Rama: ${esc(t.branch)}${t.worktree ? ` · carpeta ${esc(t.worktree)}` : ''}</p>` : ''}`;
    } else if (tab === 'bitacora') {
      if (!history) { body.innerHTML = '<p class="empty">Leyendo la bitácora…</p>'; return; }
      if (history.error) { body.innerHTML = `<p class="empty">${esc(history.error)}</p>`; return; }
      const turns = [...history.turns].reverse();
      body.innerHTML = turns.length ? turns.map((u, i) => `
        <div class="turn">
          <div class="when">#${history.turns.length - i} · ${esc(fmtDate(u.t))}</div>
          <div class="who you">🧑 TÚ PEDISTE</div>
          <div class="txt clamp">${rich(u.prompt)}</div>
          ${u.reply ? `<div class="who claude">🤖 CLAUDE RESPONDIÓ</div><div class="txt clamp">${rich(u.reply)}</div>` : ''}
          ${u.recap ? `<div class="who recap">📝 RESUMEN</div><div class="txt">${rich(u.recap)}</div>` : ''}
          ${u.ask ? `<div class="who" style="color:var(--orange)">🔔 PREGUNTÓ</div><div class="txt">${rich(u.ask)}</div>` : ''}
          <div class="meta">${u.tools} acciones${u.files.length ? ` · ${u.files.length} archivos: ${u.files.slice(0, 4).map(f => esc(f.split(/[\\/]/).pop())).join(', ')}${u.files.length > 4 ? '…' : ''}` : ''}${u.plan ? ` · ${u.plan.filter(s => s.status === 'completed').length}/${u.plan.length} pasos` : ''}</div>
          <button class="more" data-more>ver todo ▾</button>
        </div>`).join('') : '<p class="empty">Todavía no hay turnos.</p>';
      body.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => {
        b.parentElement.querySelectorAll('.txt.clamp').forEach(x => x.classList.toggle('clamp'));
        b.textContent = b.textContent.includes('▾') ? 'ver menos ▴' : 'ver todo ▾';
      }));
    } else if (tab === 'tareas') {
      const plans = history?.turns?.filter(u => u.plan).map(u => ({ t: u.t, plan: u.plan })) || [];
      const unique = [];
      for (const x of plans) { const k = x.plan.map(s => s.content).join('|'); if (!unique.length || unique[unique.length - 1].k !== k) unique.push({ ...x, k }); else unique[unique.length - 1] = { ...x, k }; }
      body.innerHTML = `
        <div class="box"><h3>LISTA ACTUAL</h3>${t.plan ? `<ul class="steps">${t.plan.map(s => `<li class="${esc(s.status)}">${rich(s.content)}</li>`).join('')}</ul>` : '<p class="empty">Este hilo no tiene lista de tareas.</p>'}</div>
        ${unique.length > 1 ? `<div class="box"><h3>LISTAS ANTERIORES</h3>${unique.slice(0, -1).reverse().map(x => `<p class="note" style="margin:8px 0 4px">${esc(fmtDate(x.t))}</p><ul class="steps">${x.plan.map(s => `<li class="${esc(s.status)}">${rich(s.content)}</li>`).join('')}</ul>`).join('')}</div>` : ''}
        ${!history ? '<p class="note">Cargando listas anteriores…</p>' : ''}`;
    } else if (tab === 'archivos') {
      if (!history) { body.innerHTML = '<p class="empty">Leyendo…</p>'; return; }
      body.innerHTML = history.fileList.length
        ? `<ul class="files">${history.fileList.map(f => `<li>${esc(f.file)} <span>${f.edits}×</span></li>`).join('')}</ul>`
        : '<p class="empty">Este hilo no ha editado archivos.</p>';
    }
  };
  // Con una pregunta pendiente, los botones rápidos le responden a esa pregunta. Todo pasa por confirmSend (recepcion.js),
  // que muestra el texto exacto con su contexto «[Oficina] …» antes de enviarlo.
  const quick = t.ask
    ? (t.replies || []).map(r => [`💬 ${r.label}`, r.answer, 'reply'])
    : [['▶ Continúa', 'Continúa con el siguiente paso de tu lista.', 'instruction']];
  quick.push(['📋 ¿Cómo vas?', 'Dame un resumen corto de cómo vas: qué está hecho, qué falta y si algo te bloquea.', 'instruction']);
  const what = `Mensaje a «${cut(t.title, 30)}»`;
  openModal(`
    <header class="modal-head">
      <span class="avatar-slot"></span>
      <div><h2>${esc(t.title)}</h2><div class="sub">${statusTag(t.status)} · 🏢 ${esc(p.name)} · ${esc(ago(t.updated))}</div></div>
      ${premiumOn() ? '<button class="pixel-btn mini premium-say" data-premium-say title="Que te cuente cómo va, con su voz de ElevenLabs (gasta créditos)">🔊 Voz premium</button>' : ''}
      <button class="pixel-btn close" data-close aria-label="Cerrar">✕</button>
    </header>
    <nav class="tabs">
      <button class="tab" data-tab="resumen">RESUMEN</button>
      <button class="tab" data-tab="bitacora">BITÁCORA</button>
      <button class="tab" data-tab="tareas">TAREAS</button>
      <button class="tab" data-tab="archivos">ARCHIVOS</button>
    </nav>
    <div class="modal-body"></div>
    <footer class="modal-foot">
      ${t.canMessage ? `
        <div class="quick">${quick.map(([l, m], i) => `<button class="pixel-btn" data-quick="${i}">${l}</button>`).join('')}</div>
        <textarea class="say" placeholder="${t.ask ? 'Escribe tu respuesta a su pregunta…' : 'Escribe una instrucción para este hilo…'}" aria-label="Mensaje para el hilo"></textarea>
        <div class="foot-row">
          <button class="pixel-btn primary" data-send>💬 ${t.ask ? 'RESPONDER' : 'ENVIAR'}</button>
          ${premium()?.puedeTranscribir() ? '<button class="pixel-btn" data-premium-mic title="Graba hasta un minuto y escribe lo que dijiste en el cuadro (no envía nada)">🎙️ premium</button>' : ''}
          <span class="grow"></span>
          ${t.canOpen ? '<button class="pixel-btn" data-open>↗ ABRIR HILO</button>' : ''}
          <button class="pixel-btn ghost" data-archive>🗄 ARCHIVAR</button>
        </div>` : `<p class="note">${p.name === 'oficina de chats' ? 'Este es el chat donde está la oficina: escríbele directamente en Claude.' : 'Este hilo no está abierto en la app (archivado o de terminal): puedes revisarlo, pero no enviarle órdenes.'}</p>`}
    </footer>`, box => {
    mountAvatar(box, t);
    box.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(box); }));
    render(box);
    fetch(`/api/thread?id=${encodeURIComponent(id)}`).then(r => r.json()).then(h => { history = h; if (modalOpen) render(box); })
      .catch(() => { history = { error: 'No pude leer la bitácora.' }; if (modalOpen) render(box); });
    const say = box.querySelector('.say');
    bindSpeakButton(box.querySelector('[data-premium-say]'), () => deskLine(t), id);
    bindPremiumMic(box.querySelector('[data-premium-mic]'), say);
    box.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => {
      const [, message, kind] = quick[Number(b.dataset.quick)];
      confirmSend({ threadId: id, kind, ask: kind === 'reply' ? t.ask : null, message }, what);
    }));
    box.querySelector('[data-send]')?.addEventListener('click', async () => {
      const m = say.value.trim();
      if (!m) { say.focus(); return; }
      if (await confirmSend({ threadId: id, kind: t.ask ? 'reply' : 'instruction', ask: t.ask, message: m }, what)) say.value = '';
    });
    say?.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) box.querySelector('[data-send]').click(); });
    box.querySelector('[data-open]')?.addEventListener('click', () => sendAction({ type: 'open', threadId: id }, 'Abrir el hilo'));
    const arch = box.querySelector('[data-archive]');
    arch?.addEventListener('click', () => {
      if (arch.dataset.sure) { sendAction({ type: 'archive', threadId: id }, `Archivar «${cut(t.title, 30)}»`); closeModal(); return; }
      arch.dataset.sure = '1'; arch.textContent = '¿SEGURO? CLIC OTRA VEZ'; arch.classList.add('warn');
    });
    avisarVentana('escritorio', box, { hilo: t, proyecto: p });
  });
}

/* ---- Pizarra de la oficina ---- */
function openBoard(key) {
  const p = projectByKey.get(key);
  if (!p) return;
  let done = 0, total = 0;
  for (const t of p.threads) if (t.status !== 'dormido') { done += t.done; total += t.total; }
  const counts = s => p.threads.filter(t => t.status === s).length;
  openModal(`
    <header class="modal-head"><div><h2>📋 PIZARRA · ${esc(p.name)}</h2><div class="sub">${esc(p.path || 'Hilos sueltos')}</div></div>
      <button class="pixel-btn close" data-close aria-label="Cerrar">✕</button></header>
    <div class="modal-body">
      <div class="box"><h3>AVANCE DE LA OFICINA (HILOS ACTIVOS)</h3>${bar(done, total)}</div>
      <div class="stats">
        <div class="stat"><b style="color:var(--green)">${counts('trabajando')}</b><span>trabajando</span></div>
        <div class="stat"><b style="color:var(--orange)">${counts('espera')}</b><span>te esperan</span></div>
        <div class="stat"><b style="color:var(--blue)">${counts('hoy')}</b><span>activos hoy</span></div>
        <div class="stat"><b>${p.threads.length}</b><span>hilos en total</span></div>
      </div>
      <div class="rows">${p.threads.map(t => threadRow(t)).join('')}</div>
    </div>
    <footer class="modal-foot"><div class="foot-row">
      ${p.path ? '<button class="pixel-btn primary" data-new>➕ NUEVO HILO</button>' : ''}
      <button class="pixel-btn" data-mega>📣 PEDIR AVANCE A TODOS</button></div></footer>`, box => {
    bindRows(box);
    box.querySelector('[data-new]')?.addEventListener('click', () => openNewThread(key));
    box.querySelector('[data-mega]').addEventListener('click', () => openBroadcast(key));
  });
}
function threadRow(t) {
  const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
  return `<button class="row" data-thread="${esc(t.id)}">
    <span class="dot" style="background:${STATUS[t.status].color}"></span>
    <span><span class="t">${esc(cut(t.title, 70))}</span><br><span class="s">${esc(STATUS[t.status].label)} · ${esc(ago(t.updated))}${t.current ? ` · ▶ ${esc(cut(t.current, 50))}` : t.ask ? ` · 🔔 ${esc(cut(t.ask, 50))}` : ''}</span></span>
    <span>${t.total ? `<div class="minibar"><i style="width:${pct}%"></i></div><span class="s">${t.done}/${t.total}</span>` : '<span class="s">—</span>'}</span>
  </button>`;
}
function bindRows(box) {
  box.querySelectorAll('[data-thread]').forEach(b => b.addEventListener('click', () => { closeModal(); goToThread(b.dataset.thread); }));
}

/* ---- Archivo (hilos dormidos o sin escritorio) ---- */
function openCabinet(key) {
  const room = map.rooms.find(r => r.key === key);
  const list = (room?.rest || []).map(id => threadById.get(id)).filter(Boolean);
  openModal(`
    <header class="modal-head"><div><h2>🗄️ ARCHIVO · ${esc(room?.name || '')}</h2><div class="sub">Hilos dormidos o sin escritorio libre</div></div>
      <button class="pixel-btn close" data-close aria-label="Cerrar">✕</button></header>
    <div class="modal-body">${list.length ? `<div class="rows">${list.map(t => threadRow(t)).join('')}</div>` : '<p class="empty">El archivo está vacío.</p>'}</div>`, box => {
    box.querySelectorAll('[data-thread]').forEach(b => b.addEventListener('click', () => openDesk(b.dataset.thread)));
  });
}

/* ---- Buzón: hilo nuevo ---- */
function openNewThread(key) {
  const p = projectByKey.get(key);
  if (!p) return;
  if (!p.path) { toast('Esta oficina no tiene carpeta de proyecto para crear hilos.', 'error'); return; }
  openModal(`
    <header class="modal-head"><div><h2>➕ NUEVO HILO EN ${esc(p.name)}</h2><div class="sub">Se crea en ${esc(p.path)}</div></div>
      <button class="pixel-btn close" data-close aria-label="Cerrar">✕</button></header>
    <div class="modal-body">
      <p>¿Qué quieres que haga el nuevo trabajador? Escríbelo como se lo dirías a Claude.</p>
      <textarea class="say" style="min-height:120px" placeholder="Ej: revisa los errores del formulario de registro y propón una solución"></textarea>
    </div>
    <footer class="modal-foot"><div class="foot-row"><button class="pixel-btn primary" data-go>CREAR HILO</button><span class="note">Ctrl+Enter para enviar</span></div></footer>`, box => {
    const say = box.querySelector('.say');
    const go = () => {
      const m = say.value.trim();
      if (!m) { say.focus(); return; }
      sendAction({ type: 'create', projectKey: key, message: m }, `Nuevo hilo en ${p.name}`);
      closeModal();
    };
    box.querySelector('[data-go]').addEventListener('click', go);
    say.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) go(); });
    avisarVentana('buzon', box, { proyecto: p });
  });
}

/* ---- Megáfono: pedir avance a todos ---- */
function openBroadcast(key) {
  const p = projectByKey.get(key);
  if (!p) return;
  const targets = p.threads.filter(t => t.canMessage && ['hoy', 'semana', 'espera'].includes(t.status));
  openModal(`
    <header class="modal-head"><div><h2>📣 PEDIR AVANCE · ${esc(p.name)}</h2><div class="sub">A los hilos que no están trabajando ahora</div></div>
      <button class="pixel-btn close" data-close aria-label="Cerrar">✕</button></header>
    <div class="modal-body">
      ${targets.length ? `<p>Les voy a pedir un resumen corto de su avance a estos ${targets.length} hilos:</p><div class="rows">${targets.map(t => threadRow(t)).join('')}</div>`
        : '<p class="empty">No hay hilos disponibles: los activos ya están trabajando o están archivados.</p>'}
    </div>
    <footer class="modal-foot"><div class="foot-row">
      <button class="pixel-btn primary" data-go ${targets.length ? '' : 'disabled'}>📣 SÍ, PREGUNTAR A ${targets.length}</button>
      <button class="pixel-btn ghost" data-close>CANCELAR</button></div></footer>`, box => {
    box.querySelector('[data-go]').addEventListener('click', () => { sendAction({ type: 'broadcast', projectKey: key }, `Avance de ${p.name}`); closeModal(); });
    box.querySelectorAll('[data-thread]').forEach(b => b.addEventListener('click', () => openDesk(b.dataset.thread)));
  });
}

/* ---- Recepción: está en recepcion.js (tarjetas para responder sin caminar) ---- */

/* ---- Directorio / ir a ---- */
function openGoto() {
  if (!world) return;
  openModal(`
    <header class="modal-head"><div><h2>🗺️ DIRECTORIO</h2><div class="sub">Elige una oficina y te llevo a la puerta</div></div>
      <button class="pixel-btn close" data-close aria-label="Cerrar">✕</button></header>
    <div class="modal-body"><div class="rows">
      <button class="row" data-room="-10"><span class="dot" style="background:#fde68a"></span><span><span class="t">Vestíbulo y recepción</span></span><span></span></button>
      ${map.rooms.map(r => {
        const p = projectByKey.get(r.key);
        const w = p.threads.filter(t => t.status === 'trabajando').length;
        const q = p.threads.filter(t => t.status === 'espera').length;
        return `<button class="row" data-room="${r.i}"><span class="dot" style="background:${r.accent}"></span>
          <span><span class="t">${esc(r.name)}</span><br><span class="s">${p.threads.length} hilos${w ? ` · ⚡ ${w} trabajando` : ''}${q ? ` · 🔔 ${q} te esperan` : ''} · ${esc(ago(p.updated))}</span></span><span class="s">ir →</span></button>`;
      }).join('')}
    </div></div>`, box => {
    box.querySelectorAll('[data-room]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.room);
      closeModal();
      if (i === -10) teleport(6, 13, 'up');
      else { const r = map.rooms[i]; teleport(r.entry.x, r.entry.y, r.top ? 'up' : 'down'); }
    }));
  });
}

function goToThread(id) {
  const o = map.objects.find(x => x.kind === 'desk' && x.thread === id);
  if (!o) { openDesk(id); return; }
  const spots = standSpots(o).sort((a, b) => b.y - a.y);
  const s = spots[0];
  if (s) teleport(s.x, s.y, 'up');
  openDesk(id);
}

function openHelp() {
  openModal(`
    <header class="modal-head"><div><h2>${XMAS ? '🎅 ¡JO JO JO! HOY ERES SANTA' : '🏢 BIENVENIDO A TU OFICINA'}</h2><div class="sub">Cada oficina es un proyecto; cada escritorio, un hilo de Claude</div></div>
      <button class="pixel-btn close" data-close aria-label="Cerrar">✕</button></header>
    <div class="modal-body help">
      ${XMAS ? '<p>🎄 La oficina se vistió de Navidad: recorre los pasillos repartiendo órdenes como Santa. Los hilos que terminaron su lista tienen un 🎁 en el escritorio. Con el botón 🏢 de arriba vuelves a la oficina normal cuando quieras.</p>' : ''}
      <p>🚶 Camina con <kbd>WASD</kbd> o las <kbd>flechas</kbd>, o haz <b>clic</b> donde quieras ir.</p>
      <p>🖥️ Acércate a un escritorio y pulsa <kbd>E</kbd> (o haz clic sobre él) para ver su <b>resumen, bitácora, tareas y archivos</b>, y darle instrucciones.</p>
      <p>⚡ Los que teclean están <b>trabajando</b>. 🔔 Los del globo naranja <b>te están esperando</b>. 💤 Los dormidos no tienen actividad hace más de una semana (están en el archivador).</p>
      <p>📋 La <b>pizarra</b> resume el avance de la oficina · ➕ el <b>buzón</b> crea un hilo nuevo · 📣 el <b>megáfono</b> pide avance a todos · 🗄️ el <b>archivador</b> guarda los dormidos.</p>
      <p>🛎️ En el vestíbulo, la <b>recepción</b> te dice quién te espera. Pulsa <kbd>M</kbd> para ir a cualquier oficina.</p>
      <p>🔊 En cada escritorio, <b>Escuchar reporte</b> hace que el trabajador te cuente cómo va; en recepción está la <b>☕ reunión de la mañana</b>. Con 🎙️ le dictas instrucciones (nunca se envían solas) y el botón 🗣️ de arriba silencia las voces (el 🔊 es la campanita de avisos).</p>
      <div class="premium-slot">${premiumHelpBox()}</div>
    </div>
    <footer class="modal-foot"><div class="foot-row"><button class="pixel-btn primary" data-close>${XMAS ? '🎁 ¡A REPARTIR!' : '¡A TRABAJAR!'}</button></div></footer>`, bindPremiumHelp);
}

/* ------------------------------------------------------------------ */
/* Órdenes                                                              */
/* ------------------------------------------------------------------ */

async function sendAction(payload, what) {
  try {
    const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oficina-Token': TOKEN }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!r.ok) { toast(`${what}: ${j.error || 'no se pudo'}`, 'error'); return null; }
    toast(`${what}: enviando…`, 'info', 2000);
    const started = Date.now();
    let warned = false;
    const poll = async () => {
      const res = await fetch(`/api/action?id=${encodeURIComponent(j.id)}`).then(x => x.json()).catch(() => null);
      if (res && res.status && res.status !== 'pending') {
        toast(`${what}: ${res.detail || res.status}`, res.status === 'error' ? 'error' : 'ok', 6000);
        setTimeout(refresh, 1500);
        return;
      }
      if (!warned && Date.now() - started > 20000) { warned = true; toast('Sigue en cola: la orden llega cuando la oficina esté abierta desde Claude.', 'info', 6000); }
      if (Date.now() - started < 300000) setTimeout(poll, 1200);
    };
    setTimeout(poll, 800);
    return j.id;
  } catch {
    toast(`${what}: no pude hablar con el servidor.`, 'error');
    return null;
  }
}

function toast(text, tone = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
  while ($('#toasts').children.length > 4) $('#toasts').firstElementChild.remove();
}

/* ------------------------------------------------------------------ */
/* Datos                                                                */
/* ------------------------------------------------------------------ */

function deskSignature(data) {
  return data.projects.map(p => `${p.key}:${p.threads.filter(t => t.status !== 'dormido').slice(0, SLOTS.length).map(t => t.id).join(',')}:${p.threads.length}`).join('|');
}

async function refresh() {
  try {
    const data = await fetch('/api/world').then(r => r.json());
    world = data;
    threadById.clear(); projectByKey.clear();
    for (const p of data.projects) { projectByKey.set(p.key, p); for (const t of p.threads) threadById.set(t.id, t); }
    const sig = deskSignature(data);
    if (sig !== signature) {
      signature = sig;
      const keep = map && walkable(player.tx, player.ty) ? { x: player.tx, y: player.ty } : null;
      map = buildMap(data);
      staticLayer = drawStatic();
      if (keep && walkable(keep.x, keep.y)) teleport(keep.x, keep.y, player.dir); else teleport(6, 14, 'up');
      currentRoom = -2;
    } else {
      for (const o of map.objects) if (o.kind === 'cabinet') o.count = map.rooms[o.room].rest.length;
    }
    $('#loading').hidden = true;
    renderHud();
    dispatchEvent(new CustomEvent('oficina:mundo', { detail: data })); // avisos.js compara con el refresco anterior
  } catch {
    $('#place').textContent = '⚠️ Sin conexión con el servidor';
  }
}

function renderHud() {
  const all = allThreads();
  const n = s => all.filter(t => t.status === s).length;
  $('#chips').innerHTML = [
    `<span class="chip"><i style="background:${STATUS.trabajando.color}"></i>${n('trabajando')} trabajando</span>`,
    `<span class="chip"><i style="background:${STATUS.espera.color}"></i>${n('espera')} te esperan</span>`,
    `<span class="chip mid"><i style="background:${STATUS.hoy.color}"></i>${n('hoy')} hoy</span>`,
    `<span class="chip extra">🏢 ${world.projects.length} oficinas · ${all.length} hilos${world.isLive ? ' · en vivo' : ''}</span>`,
  ].join('');
  $('#waiting-count').textContent = n('espera');
}

function applyThemeChrome() {
  document.body.classList.toggle('navidad', XMAS);
  $('.hud-title .word').textContent = XMAS ? 'OFICINA NAVIDEÑA' : 'OFICINA';
  $('.hud-title .logo').textContent = XMAS ? '🎄' : '🏢';
  $('#btn-theme').textContent = XMAS ? '🏢' : '🎄';
  $('#btn-theme').title = XMAS ? 'Volver a la oficina normal' : 'Poner la oficina navideña';
  document.title = XMAS ? 'Oficina navideña' : 'Oficina de chats';
}
function toggleTheme() {
  XMAS = !XMAS;
  try { localStorage.setItem('oficina-tema', XMAS ? 'navidad' : 'normal'); } catch {}
  applyThemeChrome();
  if (world) {
    const keep = { x: player.tx, y: player.ty, dir: player.dir };
    map = buildMap(world);
    staticLayer = drawStatic();
    if (walkable(keep.x, keep.y)) teleport(keep.x, keep.y, keep.dir); else teleport(6, 14, 'up');
  }
  toast(XMAS ? '🎅 ¡Jo jo jo! La oficina se puso navideña.' : '🏢 De vuelta a la oficina normal.', 'ok', 3000);
}
applyThemeChrome();
$('#btn-theme').addEventListener('click', toggleTheme);
$('#btn-waiting').addEventListener('click', () => openReception());
$('#btn-goto').addEventListener('click', openGoto);
$('#btn-help').addEventListener('click', openHelp);

refresh().then(() => {
  let seen = false;
  const helpKey = XMAS ? 'oficina-help-navidad' : 'oficina-help';
  try { seen = localStorage.getItem(helpKey) === '1'; localStorage.setItem(helpKey, '1'); } catch {}
  if (!seen) openHelp();
});
setInterval(() => { if (!document.hidden) refresh(); }, 8000);
requestAnimationFrame(loop);
