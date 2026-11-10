'use strict';
/* Oficina de chats — ambiente del juego.
   Luz según la hora real, decoración temática por oficina (mapa de palabras clave), jardín
   exterior, puertas corredizas, confeti al llegar al 100 %, transición al entrar y minimapa.
   Todo dibujado con código. Usa las variables del juego (map, cam, SCALE, XMAS, player…) solo
   al dibujar. Para probar otra hora: agrega ?hora=21 a la dirección. */
window.AMB = (() => {
  const { R, OUT, tone, mix, mk, shadow } = SPR;
  const cache = new Map();
  const memo = (k, f) => { let v = cache.get(k); if (v === undefined) { if (cache.size > 600) cache.clear(); v = f(); cache.set(k, v); } return v; };
  const rnd = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* ------------------------------------------------------------------ */
  /* Temas por palabras clave                                             */
  /* ------------------------------------------------------------------ */

  // Cada tema: palabras (de 3 letras o menos deben coincidir completas), piso y muebles por puesto:
  // S1/S2 = muebles altos a los lados, F1/F2 = muebles pequeños al fondo, A (2 de ancho) y B = cuadros en la pared.
  const THEMES = {
    agro: { label: 'Vivero', emoji: '🌴', floor: 'wood', S1: 'palm', S2: 'palm', A: 'blueprint', B: 'mapa', F1: 'sacks', F2: 'crate',
      words: ['palma', 'palmas', 'vivero', 'agro', 'finca', 'cultivo', 'campo', 'granja', 'semilla', 'cosecha', 'riego', 'huerta', 'jardin', 'garden', 'farm', 'cafe', 'cacao', 'bosque', 'forest', 'planta', 'flores'] },
    server: { label: 'Sala de servidores', emoji: '🖥️', floor: 'tech', S1: 'rack', S2: 'rack', A: 'pantalla', B: 'diagrama', F1: 'ups', F2: 'cables',
      words: ['indes', 'syndes', 'api', 'server', 'servidor', 'backend', 'infra', 'devops', 'docker', 'k8s', 'kubernetes', 'cloud', 'nube', 'db', 'sql', 'datos', 'data', 'redes', 'network', 'bot', 'bots', 'scraper', 'servicio'] },
    aula: { label: 'Aula', emoji: '📚', floor: 'carpet', S1: 'bookshelf', S2: 'bookshelf', A: 'tablero', B: 'abc', F1: 'globe', F2: 'books',
      words: ['ypri', 'clase', 'curso', 'escuela', 'colegio', 'aula', 'edu', 'educa', 'profe', 'tesis', 'universidad', 'estudio', 'learn', 'school', 'tutor', 'leccion', 'libro', 'academ'] },
    taller: { label: 'Taller', emoji: '🔧', floor: 'concrete', S1: 'toolshelf', S2: 'estante', A: 'pegboard', B: 'circuito', F1: 'printer', F2: 'boxes',
      words: ['anillo', 'iot', 'arduino', 'hardware', 'robot', 'sensor', 'maker', '3d', 'electro', 'firmware', 'esp32', 'circuito', 'taller', 'impresora', 'dron'] },
    creativo: { label: 'Estudio creativo', emoji: '🎮', floor: 'checker', S1: 'arcade', S2: 'puff', A: 'poster', B: 'vinilo', F1: 'easel', F2: 'ficusSmall',
      words: ['juego', 'game', 'pixel', 'arte', 'art', 'diseno', 'design', 'foto', 'video', 'musica', 'music', 'animacion', 'chat', 'chats', 'oficina', 'web', 'app', 'marca'] },
    negocio: { label: 'Oficina comercial', emoji: '📈', floor: 'marble', S1: 'ficus', S2: 'ficus', A: 'chart', B: 'diploma', F1: 'cooler', F2: 'safe',
      words: ['tienda', 'shop', 'venta', 'factura', 'contab', 'finanz', 'comercial', 'crm', 'presupuesto', 'negocio', 'empresa', 'cliente', 'marketing', 'cotiz', 'nomina', 'energia'] },
    borrador: { label: 'Borradores', emoji: '📝', floor: 'messy', S1: 'pila', S2: 'pila', A: 'notas', B: 'notas2', F1: 'papeles', F2: 'bin',
      words: ['borrador', 'scratch', 'temp', 'tmp', 'pruebas', 'sandbox', 'notas'] },
    generico: { label: 'Oficina', emoji: '🏢', floor: null, S1: 'bookshelf', S2: 'ficus', A: 'painting', B: 'calendar', F1: null, F2: 'ficusSmall', words: [] },
  };
  function matches(text, theme) {
    const tokens = norm(text).split(/[^a-z0-9]+/).filter(Boolean);
    return theme.words.some(w => (w.length <= 3 ? tokens.includes(w) : tokens.some(tok => tok.includes(w))));
  }
  function themeOf(p) {
    const ids = Object.keys(THEMES).filter(k => k !== 'generico');
    const name = p?.name || '';
    const tail = String(p?.path || '').split(/[\\/]/).filter(Boolean).slice(-2).join(' ');
    for (const text of [name, tail]) for (const id of ids) if (matches(text, THEMES[id])) return id;
    return 'generico';
  }

  const ANIM = new Set(['palm', 'ficus', 'ficusSmall', 'rack', 'ups', 'arcade', 'printer', 'pantalla', 'window', 'clock', 'sconce', 'puff']);
  function deco(objects, item, room, x, y, w, h, extra = {}) {
    objects.push({ kind: 'deco', item, room, x, y, w, h, solid: true, deco: true, anim: ANIM.has(item), ...extra });
  }

  /** Agrega la decoración de cada oficina, del vestíbulo y del pasillo (se llama al armar el mapa). */
  function decorate(rooms, objects, projects) {
    for (const r of rooms) {
      const p = projects[r.i];
      const id = themeOf(p);
      const th = THEMES[id];
      r.theme = id;
      const X = lx => r.x0 + lx, Y = ly => r.y0 + ly;
      const wall = r.y0; // pared de arriba, con su cara visible desde adentro
      const on = { onWall: true };
      if (r.top) {
        deco(objects, 'window', r.i, X(3), wall, 1, 1, on);
        deco(objects, 'window', r.i, X(6), wall, 1, 1, on);
        deco(objects, th.A, r.i, X(4), wall, 2, 1, on);
        deco(objects, th.B, r.i, X(8), wall, 1, 1, on);
      } else {
        deco(objects, th.A, r.i, X(2), wall, 2, 1, on);
        deco(objects, th.B, r.i, X(5), wall, 1, 1, on);
      }
      deco(objects, 'clock', r.i, X(9), wall, 1, 1, on);
      deco(objects, 'sconce', r.i, X(1), wall, 1, 1, on);
      deco(objects, 'sconce', r.i, X(14), wall, 1, 1, on);
      if (th.S1) deco(objects, th.S1, r.i, X(1), Y(4), 1, 2, { seed: r.i * 3 + 1 });
      if (th.S2) deco(objects, th.S2, r.i, X(14), Y(4), 1, 2, { seed: r.i * 3 + 2 });
      if (th.F1) deco(objects, th.F1, r.i, X(4), Y(8), 1, 1, { seed: r.i * 5 + 1 });
      if (th.F2) deco(objects, th.F2, r.i, X(11), Y(8), 1, 1, { seed: r.i * 5 + 2 });
      if (r.top) { // apliques en el pasillo, a los lados de cada puerta
        deco(objects, 'sconce', -20, X(3), r.y0 + 9, 1, 1, on);
        deco(objects, 'sconce', -20, X(12), r.y0 + 9, 1, 1, on);
      }
    }
    // Vestíbulo
    deco(objects, 'window', -10, 1, 6, 1, 1, { onWall: true });
    deco(objects, 'window', -10, 10, 6, 1, 1, { onWall: true });
    deco(objects, 'clock', -10, 9, 6, 1, 1, { onWall: true });
    deco(objects, 'floorlamp', -10, 2, 15, 1, 1);
  }

  /* ------------------------------------------------------------------ */
  /* Capa fija: exterior, pisos temáticos y sombras suaves                */
  /* ------------------------------------------------------------------ */

  const VOIDT = 0, FLOORT = 1, WALLT = 2, CORRT = 3, LOBBYT = 4, DOORT = 5;
  const tAt = (m, x, y) => (x >= 0 && y >= 0 && x < m.W && y < m.H ? m.tiles[y * m.W + x] : VOIDT);

  function outdoorLayout(m) {
    const isVoid = (x, y) => tAt(m, x, y) === VOIDT;
    const L = { lamps: [], trees: [], benches: [], bushes: [] };
    const add = (list, x, y, ok = isVoid(x, y)) => { if (ok) list.push({ x, y }); };
    add(L.lamps, 4, 19); add(L.lamps, 7, 19); add(L.lamps, 7, 3);
    add(L.trees, 1, 20, isVoid(1, 20) && isVoid(2, 21)); add(L.trees, 10, 21, isVoid(10, 21) && isVoid(11, 22));
    add(L.trees, 1, 1, isVoid(1, 1) && isVoid(2, 2)); add(L.trees, 9, 1, isVoid(9, 1) && isVoid(10, 2));
    add(L.benches, 8, 19, isVoid(8, 19) && isVoid(9, 19)); add(L.benches, 4, 3, isVoid(4, 3) && isVoid(5, 3));
    for (const x of [1, 2, 3, 8, 9, 10, 11]) add(L.bushes, x, 18);
    for (const x of [1, 3, 4, 5, 6, 7, 8, 10, 11]) add(L.bushes, x, 5);
    return L;
  }

  function ground(g, m) {
    const snow = XMAS;
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      if (tAt(m, x, y) !== VOIDT) continue;
      const bx = x * 16, by = y * 16;
      const path = (x === 5 || x === 6) && y >= 18;
      if (path) {
        R(g, snow ? '#c9d3e0' : '#cfc3ae', bx, by, 16, 16);
        R(g, snow ? '#b4c0d0' : '#b8aa92', bx, by + 7, 16, 1); R(g, snow ? '#b4c0d0' : '#b8aa92', bx + (y % 2 ? 4 : 11), by, 1, 7); R(g, snow ? '#b4c0d0' : '#b8aa92', bx + (y % 2 ? 11 : 4), by + 8, 1, 8);
        continue;
      }
      R(g, snow ? '#eef3fa' : '#6fbf5a', bx, by, 16, 16);
      for (let k = 0; k < 6; k++) {
        const px = Math.floor(rnd(x * 7 + k, y) * 15), py = Math.floor(rnd(x, y * 5 + k) * 15);
        R(g, snow ? '#dbe5f1' : (k % 2 ? '#5fae4c' : '#86cf6c'), bx + px, by + py, k % 3 ? 1 : 2, 1);
      }
      if (rnd(x, y) > 0.86) { // florecitas o destellos de nieve
        const fx = bx + 3 + Math.floor(rnd(y, x) * 9), fy = by + 3 + Math.floor(rnd(x + 3, y) * 9);
        if (snow) { R(g, '#ffffff', fx, fy, 1, 1); R(g, '#c7d6ea', fx + 1, fy + 1, 1, 1); }
        else { const col = ['#fff7ad', '#ffffff', '#ff9ec7', '#c4b5fd'][Math.floor(rnd(fx, fy) * 4)]; R(g, col, fx - 1, fy, 3, 1); R(g, col, fx, fy - 1, 1, 3); R(g, '#f59e0b', fx, fy, 1, 1); }
      }
    }
  }
  function tree(g, x, y) {
    const bx = x * 16, by = y * 16;
    shadow(g, bx + 16, by + 29, 26, 0.2);
    R(g, OUT, bx + 13, by + 18, 6, 12); R(g, '#7c4a2d', bx + 14, by + 18, 4, 11); R(g, '#5b3520', bx + 16, by + 19, 2, 10);
    if (XMAS) { // pino nevado
      const tiers = [[by + 22, 26], [by + 14, 20], [by + 6, 13]];
      for (const [ty, w] of tiers) for (let r = 0; r < 9; r++) {
        const ww = Math.round(w * (r + 1) / 9);
        R(g, OUT, bx + 16 - Math.floor(ww / 2) - 1, ty - 9 + r, ww + 2, 1);
        R(g, r < 2 ? '#f8fafc' : r % 3 ? '#166534' : '#15803d', bx + 16 - Math.floor(ww / 2), ty - 9 + r, ww, 1);
      }
      R(g, '#ffffff', bx + 15, by - 4, 2, 2);
    } else {
      const blob = (cx, cy, rr, col) => { for (let yy = -rr; yy <= rr; yy++) { const w = Math.round(Math.sqrt(rr * rr - yy * yy)); R(g, col, bx + cx - w, by + cy + yy, w * 2, 1); } };
      blob(16, 9, 12, OUT); blob(9, 13, 8, OUT); blob(23, 13, 8, OUT);
      blob(16, 9, 11, '#3f9a4a'); blob(9, 13, 7, '#3f9a4a'); blob(23, 13, 7, '#3f9a4a');
      blob(14, 6, 6, '#5cbf5c'); blob(21, 11, 4, '#5cbf5c'); blob(12, 4, 2, '#8fe08a');
      R(g, '#ff6b6b', bx + 8, by + 10, 2, 2); R(g, '#ff6b6b', bx + 22, by + 6, 2, 2); R(g, '#ff6b6b', bx + 17, by + 14, 2, 2);
    }
  }
  function bush(g, x, y) {
    const bx = x * 16, by = y * 16 + 4;
    R(g, OUT, bx + 1, by + 2, 14, 10); R(g, OUT, bx + 3, by, 10, 13);
    R(g, XMAS ? '#1f6f43' : '#3f9a4a', bx + 2, by + 3, 12, 8); R(g, XMAS ? '#1f6f43' : '#3f9a4a', bx + 4, by + 1, 8, 11);
    R(g, XMAS ? '#f8fafc' : '#5cbf5c', bx + 4, by + 1, 7, 2); R(g, XMAS ? '#e2e8f0' : '#5cbf5c', bx + 2, by + 3, 3, 2);
    if (!XMAS && (x + y) % 3 === 0) { R(g, '#ffd166', bx + 6, by + 6, 2, 2); R(g, '#ff9ec7', bx + 10, by + 4, 2, 2); }
    if (XMAS && (x + y) % 2 === 0) { R(g, '#ef4444', bx + 6, by + 6, 2, 2); R(g, '#ffd166', bx + 10, by + 8, 2, 2); }
  }
  function lamppost(g, x, y) {
    const bx = x * 16, by = y * 16;
    shadow(g, bx + 8, by + 15, 8, 0.25);
    R(g, OUT, bx + 6, by - 10, 4, 26); R(g, '#3b3557', bx + 7, by - 9, 2, 24);
    R(g, OUT, bx + 3, by - 16, 10, 7); R(g, '#57507a', bx + 4, by - 15, 8, 2); R(g, '#fde68a', bx + 5, by - 13, 6, 3);
    R(g, OUT, bx + 5, by + 13, 6, 3);
    if (XMAS) { R(g, '#f8fafc', bx + 3, by - 17, 10, 2); R(g, '#dc2626', bx + 6, by - 4, 4, 2); R(g, '#16a34a', bx + 6, by - 2, 4, 1); }
  }
  function bench(g, x, y) {
    const bx = x * 16, by = y * 16;
    shadow(g, bx + 16, by + 15, 28, 0.2);
    R(g, OUT, bx + 2, by + 3, 28, 7); R(g, '#a8714c', bx + 3, by + 4, 26, 2); R(g, '#c08457', bx + 3, by + 7, 26, 2);
    R(g, OUT, bx + 4, by + 10, 2, 5); R(g, OUT, bx + 26, by + 10, 2, 5);
    if (XMAS) R(g, '#f8fafc', bx + 3, by + 3, 26, 1);
  }

  const FLOORS = {
    wood: (g, bx, by, x, y, a) => {
      R(g, '#c9975f', bx, by, 16, 16); R(g, '#b58250', bx, by + 3, 16, 1); R(g, '#b58250', bx, by + 7, 16, 1); R(g, '#b58250', bx, by + 11, 16, 1); R(g, '#b58250', bx, by + 15, 16, 1);
      R(g, '#a06f42', bx + ((x * 5 + y) % 13), by, 1, 3); R(g, '#a06f42', bx + ((x * 9 + y * 3) % 15), by + 4, 1, 3); R(g, '#a06f42', bx + ((x * 3 + y * 7) % 11) + 2, by + 8, 1, 3);
      R(g, '#d9a971', bx + ((x * 11) % 9) + 3, by + 13, 3, 1);
    },
    tech: (g, bx, by, x, y) => {
      R(g, '#b9c4d4', bx, by, 16, 16); R(g, '#9aa7bb', bx, by, 16, 1); R(g, '#9aa7bb', bx, by, 1, 16); R(g, '#d3dbe6', bx + 1, by + 1, 15, 1);
      if ((x + y) % 3 === 0) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) R(g, '#a3afc2', bx + 4 + k * 4, by + 4 + j * 4, 1, 1);
    },
    carpet: (g, bx, by, x, y, a) => {
      const base = tone(a, 0.45);
      R(g, base, bx, by, 16, 16);
      for (let k = 0; k < 5; k++) R(g, tone(a, 0.36), bx + Math.floor(rnd(x + k, y) * 16), by + Math.floor(rnd(x, y + k) * 16), 1, 1);
      if ((x + y) % 2 === 0) R(g, tone(a, 0.52), bx + 6, by + 6, 4, 4);
    },
    concrete: (g, bx, by, x, y) => {
      R(g, '#b7b2ab', bx, by, 16, 16); R(g, '#a39d95', bx, by + 15, 16, 1); R(g, '#a39d95', bx + 15, by, 1, 16);
      for (let k = 0; k < 6; k++) R(g, k % 2 ? '#c9c4bd' : '#9d978f', bx + Math.floor(rnd(x * 3 + k, y) * 15), by + Math.floor(rnd(x, y * 3 + k) * 15), 1, 1);
    },
    checker: (g, bx, by, x, y, a) => {
      R(g, (x + y) % 2 ? '#f4efe6' : tone(a, 0.3), bx, by, 16, 16);
      R(g, (x + y) % 2 ? '#e6dfd2' : tone(a, 0.15), bx, by + 15, 16, 1);
    },
    marble: (g, bx, by, x, y) => {
      R(g, '#ebe6dc', bx, by, 16, 16); R(g, '#d8d1c3', bx, by, 16, 1); R(g, '#d8d1c3', bx, by, 1, 16);
      const v = Math.floor(rnd(x, y) * 10);
      for (let k = 0; k < 6; k++) R(g, '#cfc7b8', bx + 2 + v + Math.round(Math.sin(k + x) * 2), by + 2 + k * 2, 1, 2);
    },
    messy: (g, bx, by, x, y, a) => {
      R(g, tone(a, 0.62), bx, by, 16, 16); R(g, tone(a, 0.55), bx, by + 15, 16, 1);
      if (rnd(x, y) > 0.7) { R(g, '#ffffff', bx + 3 + (x % 7), by + 4 + (y % 6), 4, 3); R(g, '#cbd5e1', bx + 4 + (x % 7), by + 5 + (y % 6), 2, 1); }
      if (rnd(y, x) > 0.85) R(g, '#fde68a', bx + 9, by + 10, 3, 3);
    },
  };

  /** Se llama justo después de pintar las baldosas: exterior, pisos y sombras. */
  function staticUnder(g, m) {
    ground(g, m);
    const L = outdoorLayout(m);
    m.outdoor = L;
    for (const b of L.bushes) bush(g, b.x, b.y);
    for (const b of L.benches) bench(g, b.x, b.y);
    for (const t of L.trees) tree(g, t.x, t.y);
    for (const l of L.lamps) lamppost(g, l.x, l.y);
    // Pisos temáticos (respetan el color de cada oficina con una alfombra central)
    for (const r of m.rooms) {
      const style = THEMES[r.theme]?.floor;
      if (!style) continue;
      for (let ly = 1; ly <= 8; ly++) for (let lx = 1; lx <= 14; lx++) {
        const x = r.x0 + lx, y = r.y0 + ly;
        if (tAt(m, x, y) !== FLOORT) continue;
        FLOORS[style](g, x * 16, y * 16, x, y, r.accent);
      }
      if (style !== 'carpet' && style !== 'checker') { // alfombra del pasillo central con el color de la oficina
        const rx = (r.x0 + 7) * 16 + 2, ry = (r.y0 + 1) * 16 + 2, rh = 8 * 16 - 4;
        R(g, tone(r.accent, -0.2), rx - 1, ry - 1, 30, rh + 2); R(g, tone(r.accent, 0.35), rx, ry, 28, rh); R(g, tone(r.accent, 0.15), rx + 3, ry + 3, 22, rh - 6);
        for (let k = 0; k < rh - 12; k += 10) R(g, tone(r.accent, 0.45), rx + 12, ry + 6 + k, 4, 4);
      }
    }
    // Sombra suave al pie de los muros
    for (let y = 1; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      const t = tAt(m, x, y);
      if ((t === FLOORT || t === LOBBYT || t === CORRT) && tAt(m, x, y - 1) === WALLT) {
        g.save(); g.fillStyle = '#1a1030';
        g.globalAlpha = 0.16; g.fillRect(x * 16, y * 16, 16, 2);
        g.globalAlpha = 0.08; g.fillRect(x * 16, y * 16 + 2, 16, 2);
        g.restore();
      }
    }
    // Sombras bajo los muebles
    for (const o of m.objects) {
      if (o.onWall || o.kind === 'directory') continue;
      if (o.kind === 'desk') { shadow(g, o.x * 16 + 16, (o.y + 2) * 16 - 1, 32, 0.2); continue; }
      if (o.kind === 'reception') { shadow(g, (o.x + o.w / 2) * 16, (o.y + o.h) * 16, o.w * 16, 0.2); continue; }
      shadow(g, (o.x + o.w / 2) * 16, (o.y + o.h) * 16 - 1, Math.max(10, o.w * 16 - 4), 0.18);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Muebles y cuadros temáticos                                          */
  /* ------------------------------------------------------------------ */

  const BOOKS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
  function shelf(g, bx, by, h, seed, fill) {
    R(g, OUT, bx + 1, by, 14, h); R(g, '#8a5634', bx + 2, by + 1, 12, h - 2); R(g, '#6b3f25', bx + 3, by + 2, 10, h - 4);
    const rows = Math.floor((h - 4) / 9);
    for (let i = 0; i < rows; i++) {
      const sy = by + 2 + i * 9;
      fill(sy, i);
      R(g, '#a8714c', bx + 2, sy + 8, 12, 1);
    }
    R(g, '#c08457', bx + 2, by + 1, 12, 1);
    void seed;
  }
  function frame(g, x, y, w, h, border, bg) { R(g, OUT, x, y, w, h); R(g, border, x + 1, y + 1, w - 2, h - 2); R(g, bg, x + 2, y + 2, w - 4, h - 4); }
  function pin(g, x, y, col = '#ef4444') { R(g, col, x, y, 2, 2); R(g, '#ffffff', x, y); }

  const ITEMS = {
    bookshelf(g, bx, by, o) {
      shelf(g, bx, by - 6, 38, o.seed, (sy, i) => {
        let x = bx + 3;
        while (x < bx + 12) {
          const w = 1 + Math.floor(rnd(x + i, o.seed) * 2), hh = 5 + Math.floor(rnd(o.seed, x * 3 + i) * 3);
          R(g, BOOKS[Math.floor(rnd(x, i + o.seed) * BOOKS.length)], x, sy + 8 - hh, w, hh);
          x += w + (rnd(x, i) > 0.8 ? 1 : 0);
        }
      });
    },
    toolshelf(g, bx, by, o) {
      R(g, OUT, bx + 1, by - 4, 14, 36); R(g, '#64748b', bx + 2, by - 3, 12, 34); R(g, '#475569', bx + 3, by - 2, 10, 32);
      for (let i = 0; i < 4; i++) {
        const sy = by - 2 + i * 8;
        R(g, '#94a3b8', bx + 2, sy + 7, 12, 1);
        R(g, ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e'][(i + o.seed) % 4], bx + 4, sy + 2, 8, 5); R(g, '#1f2937', bx + 7, sy + 3, 2, 1);
      }
    },
    estante(g, bx, by, o) {
      R(g, OUT, bx + 1, by - 4, 14, 36); R(g, '#a8714c', bx + 2, by - 3, 12, 34); R(g, '#7c4a2d', bx + 3, by - 2, 10, 32);
      for (let i = 0; i < 3; i++) {
        const sy = by - 2 + i * 11;
        R(g, '#c08457', bx + 2, sy + 10, 12, 1);
        R(g, OUT, bx + 3, sy + 3, 10, 7); R(g, '#d6a56b', bx + 4, sy + 4, 8, 5); R(g, '#b98a52', bx + 4, sy + 6, 8, 1);
        R(g, ['#22c55e', '#ef4444', '#3b82f6'][(i + o.seed) % 3], bx + 6, sy + 4, 4, 2);
      }
    },
    rack(g, bx, by) {
      R(g, OUT, bx + 1, by - 6, 14, 38); R(g, '#1f2937', bx + 2, by - 5, 12, 36); R(g, '#374151', bx + 2, by - 5, 12, 1);
      for (let i = 0; i < 7; i++) { R(g, '#111827', bx + 3, by - 3 + i * 5, 10, 4); R(g, '#4b5563', bx + 3, by - 3 + i * 5, 10, 1); }
      R(g, '#6b7280', bx + 12, by - 4, 1, 34);
    },
    palm(g, bx, by) {
      R(g, OUT, bx + 3, by + 22, 10, 10); R(g, '#c2552d', bx + 4, by + 23, 8, 8); R(g, '#e07a4f', bx + 4, by + 23, 8, 2); R(g, '#9a3412', bx + 9, by + 25, 3, 6);
      for (let y = 6; y < 23; y++) { const sx = bx + 7 + Math.round(Math.sin(y / 5) * 1); R(g, OUT, sx - 1, by + y, 4, 1); R(g, y % 3 ? '#a0703c' : '#7c522a', sx, by + y, 2, 1); }
    },
    ficus(g, bx, by) {
      R(g, OUT, bx + 3, by + 22, 10, 10); R(g, '#e2e8f0', bx + 4, by + 23, 8, 8); R(g, '#cbd5e1', bx + 9, by + 23, 3, 8); R(g, '#94a3b8', bx + 4, by + 23, 8, 1);
      R(g, OUT, bx + 7, by + 10, 3, 13); R(g, '#7c4a2d', bx + 8, by + 10, 1, 13);
    },
    ficusSmall(g, bx, by) { SPR.plantPot(g, bx, by); },
    arcade(g, bx, by) {
      R(g, OUT, bx + 1, by - 6, 14, 38); R(g, '#7c3aed', bx + 2, by - 5, 12, 36); R(g, '#5b21b6', bx + 11, by - 5, 3, 36);
      R(g, '#facc15', bx + 2, by - 5, 12, 3); R(g, OUT, bx + 3, by - 1, 10, 9);
      R(g, '#1f2937', bx + 2, by + 11, 12, 4); R(g, '#ef4444', bx + 4, by + 12, 2, 2); R(g, '#22d3ee', bx + 9, by + 12, 2, 2); R(g, '#e5e7eb', bx + 6, by + 12, 1, 2);
      R(g, '#4c1d95', bx + 4, by + 18, 8, 10); R(g, '#facc15', bx + 6, by + 20, 4, 1);
    },
    puff(g, bx, by) {
      // lámpara de pie arriba y puf abajo
      R(g, OUT, bx + 7, by - 2, 2, 18); R(g, OUT, bx + 3, by - 8, 10, 7); R(g, '#fde68a', bx + 4, by - 7, 8, 5); R(g, '#f59e0b', bx + 4, by - 3, 8, 1);
      R(g, OUT, bx + 5, by + 14, 6, 2);
      R(g, OUT, bx + 1, by + 19, 14, 12); R(g, OUT, bx + 3, by + 17, 10, 15);
      R(g, '#f472b6', bx + 2, by + 20, 12, 10); R(g, '#f472b6', bx + 4, by + 18, 8, 13); R(g, '#f9a8d4', bx + 4, by + 19, 5, 3); R(g, '#db2777', bx + 3, by + 28, 10, 2);
    },
    pila(g, bx, by, o) {
      for (let i = 0; i < 4; i++) {
        const y = by + 24 - i * 8, x = bx + 2 + (i % 2) - ((o.seed + i) % 2);
        R(g, OUT, x, y, 12, 8); R(g, '#d6a56b', x + 1, y + 1, 10, 6); R(g, '#b98a52', x + 1, y + 3, 10, 1); R(g, '#ffffff', x + 3, y + 4, 4, 2);
      }
      R(g, '#ffffff', bx + 3, by - 9, 9, 2); R(g, '#e2e8f0', bx + 4, by - 8, 8, 1);
    },
    sacks(g, bx, by) {
      const sack = (x, y) => { R(g, OUT, x, y + 1, 8, 9); R(g, OUT, x + 1, y, 6, 11); R(g, '#d9c08a', x + 1, y + 2, 6, 7); R(g, '#c4a66a', x + 5, y + 2, 2, 7); R(g, '#b08d4f', x + 2, y + 1, 4, 1); R(g, '#3f9a4a', x + 2, y + 5, 3, 2); };
      sack(bx + 1, by + 4); sack(bx + 7, by + 5);
    },
    crate(g, bx, by) {
      R(g, OUT, bx + 1, by + 5, 14, 11); R(g, '#b98a52', bx + 2, by + 6, 12, 9); R(g, '#8a5634', bx + 2, by + 10, 12, 1); R(g, '#8a5634', bx + 7, by + 6, 1, 9);
      for (let k = 0; k < 4; k++) { R(g, OUT, bx + 2 + k * 3, by + 2, 4, 4); R(g, ['#f59e0b', '#ef4444', '#eab308', '#84cc16'][k], bx + 3 + k * 3, by + 3, 2, 2); }
    },
    ups(g, bx, by) {
      R(g, OUT, bx + 2, by + 4, 12, 12); R(g, '#374151', bx + 3, by + 5, 10, 10); R(g, '#4b5563', bx + 3, by + 5, 10, 1);
      R(g, '#111827', bx + 4, by + 8, 8, 3);
    },
    cables(g, bx, by) {
      R(g, OUT, bx + 2, by + 5, 12, 11); R(g, '#f59e0b', bx + 3, by + 6, 10, 9); R(g, '#d97706', bx + 3, by + 8, 10, 1); R(g, '#d97706', bx + 3, by + 11, 10, 1);
      R(g, OUT, bx + 6, by + 8, 4, 4); R(g, '#3b82f6', bx + 13, by + 13, 3, 1); R(g, '#3b82f6', bx + 15, by + 10, 1, 4);
    },
    globe(g, bx, by) {
      R(g, OUT, bx + 6, by + 12, 4, 4); R(g, '#8a5634', bx + 5, by + 14, 6, 2);
      R(g, OUT, bx + 3, by + 1, 10, 11); R(g, '#3b82f6', bx + 4, by + 2, 8, 9); R(g, '#22c55e', bx + 5, by + 3, 3, 3); R(g, '#22c55e', bx + 8, by + 6, 3, 3); R(g, '#93c5fd', bx + 5, by + 2, 2, 1);
      R(g, '#eab308', bx + 2, by + 6, 1, 4);
    },
    books(g, bx, by) {
      for (let i = 0; i < 4; i++) { R(g, OUT, bx + 2 + (i % 2), by + 12 - i * 3, 12, 4); R(g, BOOKS[i * 2], bx + 3 + (i % 2), by + 13 - i * 3, 10, 2); R(g, '#f8fafc', bx + 11 + (i % 2), by + 13 - i * 3, 2, 2); }
    },
    printer(g, bx, by) {
      R(g, OUT, bx + 1, by + 1, 14, 15); R(g, '#e5e7eb', bx + 2, by + 2, 12, 13); R(g, '#9ca3af', bx + 3, by + 4, 10, 8);
      R(g, '#1f2937', bx + 3, by + 12, 10, 2);
    },
    boxes(g, bx, by) {
      R(g, OUT, bx + 1, by + 7, 10, 9); R(g, '#d6a56b', bx + 2, by + 8, 8, 7); R(g, '#b98a52', bx + 2, by + 10, 8, 1);
      R(g, OUT, bx + 6, by + 2, 9, 8); R(g, '#e0b47c', bx + 7, by + 3, 7, 6); R(g, '#b98a52', bx + 7, by + 5, 7, 1); R(g, '#ef4444', bx + 9, by + 6, 3, 2);
    },
    easel(g, bx, by) {
      R(g, OUT, bx + 3, by + 6, 2, 10); R(g, OUT, bx + 11, by + 6, 2, 10); R(g, OUT, bx + 7, by + 4, 2, 12);
      R(g, OUT, bx + 2, by - 2, 12, 10); R(g, '#fffbeb', bx + 3, by - 1, 10, 8);
      R(g, '#60a5fa', bx + 3, by - 1, 10, 3); R(g, '#fde047', bx + 9, by, 2, 2); R(g, '#4ade80', bx + 3, by + 4, 10, 3); R(g, '#16a34a', bx + 5, by + 3, 3, 1);
    },
    cooler(g, bx, by) {
      R(g, OUT, bx + 3, by + 5, 10, 11); R(g, '#e2e8f0', bx + 4, by + 6, 8, 9); R(g, '#ef4444', bx + 5, by + 9, 2, 2); R(g, '#3b82f6', bx + 9, by + 9, 2, 2);
      R(g, OUT, bx + 4, by - 2, 8, 8); R(g, '#7dd3fc', bx + 5, by - 1, 6, 6); R(g, '#bae6fd', bx + 5, by - 1, 2, 4);
    },
    safe(g, bx, by) {
      R(g, OUT, bx + 1, by + 2, 14, 14); R(g, '#4b5563', bx + 2, by + 3, 12, 12); R(g, '#6b7280', bx + 2, by + 3, 12, 1);
      R(g, OUT, bx + 5, by + 6, 6, 6); R(g, '#d1d5db', bx + 6, by + 7, 4, 4); R(g, OUT, bx + 7, by + 8, 2, 2); R(g, '#facc15', bx + 12, by + 8, 1, 3);
    },
    papeles(g, bx, by) {
      for (let i = 0; i < 4; i++) { const x = bx + 1 + i * 3, y = by + 6 + (i % 2) * 4; R(g, '#cbd5e1', x, y + 1, 7, 6); R(g, '#ffffff', x, y, 7, 6); R(g, '#94a3b8', x + 1, y + 2, 4, 1); }
      R(g, '#f8fafc', bx + 9, by + 2, 4, 4); R(g, '#cbd5e1', bx + 10, by + 3, 2, 2);
    },
    bin(g, bx, by) {
      R(g, OUT, bx + 3, by + 5, 10, 11); R(g, '#64748b', bx + 4, by + 6, 8, 9); R(g, '#475569', bx + 4, by + 9, 8, 1); R(g, '#475569', bx + 4, by + 12, 8, 1);
      for (const [x, y] of [[4, 2], [8, 1], [6, 4], [11, 3]]) { R(g, OUT, bx + x - 1, by + y - 1, 5, 5); R(g, '#f8fafc', bx + x, by + y, 3, 3); }
      R(g, '#f8fafc', bx + 13, by + 13, 3, 3);
    },
    floorlamp(g, bx, by) {
      R(g, OUT, bx + 7, by - 6, 2, 21); R(g, OUT, bx + 4, by + 13, 8, 3);
      R(g, OUT, bx + 3, by - 13, 10, 8); R(g, '#fde68a', bx + 4, by - 12, 8, 6); R(g, '#f59e0b', bx + 4, by - 7, 8, 1); R(g, '#fff7cc', bx + 5, by - 12, 3, 2);
    },
    // ---- Cuadros en la pared (la cara del muro va de by+6 a by+15) ----
    blueprint(g, bx, by) {
      frame(g, bx + 1, by + 3, 30, 12, '#1e3a8a', '#2563eb');
      R(g, '#bfdbfe', bx + 4, by + 6, 10, 1); R(g, '#bfdbfe', bx + 4, by + 6, 1, 6); R(g, '#bfdbfe', bx + 4, by + 11, 10, 1); R(g, '#bfdbfe', bx + 13, by + 6, 1, 6);
      R(g, '#bfdbfe', bx + 8, by + 6, 1, 3); R(g, '#bfdbfe', bx + 17, by + 7, 10, 1); R(g, '#bfdbfe', bx + 17, by + 9, 7, 1); R(g, '#bfdbfe', bx + 17, by + 11, 9, 1);
      R(g, '#93c5fd', bx + 22, by + 5, 4, 1); pin(g, bx + 2, by + 3); pin(g, bx + 28, by + 3, '#22c55e');
    },
    mapa(g, bx, by) {
      frame(g, bx + 1, by + 3, 14, 12, '#a16207', '#fef3c7');
      R(g, '#86efac', bx + 3, by + 5, 4, 3); R(g, '#4ade80', bx + 8, by + 5, 5, 4); R(g, '#bbf7d0', bx + 3, by + 9, 5, 3); R(g, '#22c55e', bx + 9, by + 10, 4, 2);
      R(g, '#60a5fa', bx + 3, by + 8, 10, 1); pin(g, bx + 10, by + 6);
    },
    pantalla(g, bx, by) { frame(g, bx + 1, by + 3, 30, 12, '#111827', '#0b1220'); R(g, OUT, bx + 14, by + 15, 4, 1); },
    diagrama(g, bx, by) {
      frame(g, bx + 1, by + 3, 14, 12, '#e2e8f0', '#f8fafc');
      for (const [x, y] of [[4, 6], [10, 6], [7, 11]]) R(g, '#3b82f6', bx + x, by + y, 3, 2);
      R(g, '#94a3b8', bx + 6, by + 7, 4, 1); R(g, '#94a3b8', bx + 5, by + 8, 1, 3); R(g, '#94a3b8', bx + 11, by + 8, 1, 3);
    },
    tablero(g, bx, by) {
      frame(g, bx + 1, by + 3, 30, 12, '#8a5634', '#1f5f45');
      R(g, '#e5e7eb', bx + 4, by + 6, 3, 1); R(g, '#e5e7eb', bx + 5, by + 6, 1, 4); R(g, '#e5e7eb', bx + 9, by + 7, 2, 1); R(g, '#e5e7eb', bx + 9, by + 9, 2, 1);
      R(g, '#e5e7eb', bx + 13, by + 6, 4, 1); R(g, '#e5e7eb', bx + 13, by + 8, 4, 1); R(g, '#fde68a', bx + 20, by + 6, 7, 1); R(g, '#e5e7eb', bx + 20, by + 8, 5, 1); R(g, '#f9a8d4', bx + 20, by + 10, 6, 1);
      R(g, '#a8714c', bx + 2, by + 13, 28, 1); R(g, '#f8fafc', bx + 24, by + 12, 3, 1);
    },
    abc(g, bx, by) {
      frame(g, bx + 1, by + 3, 14, 12, '#f59e0b', '#fffbeb');
      R(g, '#ef4444', bx + 3, by + 6, 3, 1); R(g, '#ef4444', bx + 3, by + 7, 1, 4); R(g, '#ef4444', bx + 5, by + 7, 1, 4); R(g, '#ef4444', bx + 4, by + 8, 1, 1);
      R(g, '#3b82f6', bx + 7, by + 6, 1, 5); R(g, '#3b82f6', bx + 8, by + 6, 1, 1); R(g, '#3b82f6', bx + 8, by + 8, 1, 1); R(g, '#3b82f6', bx + 8, by + 10, 1, 1);
      R(g, '#22c55e', bx + 10, by + 6, 3, 1); R(g, '#22c55e', bx + 10, by + 7, 1, 3); R(g, '#22c55e', bx + 10, by + 10, 3, 1);
    },
    pegboard(g, bx, by) {
      frame(g, bx + 1, by + 3, 30, 12, '#92400e', '#d6a56b');
      for (let x = 4; x < 30; x += 3) for (let y = 6; y < 13; y += 3) R(g, '#b98a52', bx + x, by + y);
      R(g, '#9ca3af', bx + 5, by + 5, 1, 7); R(g, '#ef4444', bx + 4, by + 11, 3, 2); R(g, '#6b7280', bx + 10, by + 6, 4, 2); R(g, '#6b7280', bx + 11, by + 8, 2, 4);
      R(g, '#3b82f6', bx + 17, by + 5, 2, 8); R(g, '#f59e0b', bx + 22, by + 6, 5, 2); R(g, '#f59e0b', bx + 24, by + 8, 1, 4);
    },
    circuito(g, bx, by) {
      frame(g, bx + 1, by + 3, 14, 12, '#065f46', '#047857');
      R(g, '#fbbf24', bx + 4, by + 6, 6, 1); R(g, '#fbbf24', bx + 9, by + 6, 1, 5); R(g, '#fbbf24', bx + 4, by + 10, 5, 1);
      R(g, '#111827', bx + 6, by + 8, 3, 3); R(g, '#d1d5db', bx + 11, by + 7, 2, 2);
    },
    poster(g, bx, by) {
      frame(g, bx + 1, by + 3, 14, 12, '#ec4899', '#1e1b4b');
      R(g, '#f472b6', bx + 4, by + 6, 2, 2); R(g, '#f472b6', bx + 7, by + 6, 2, 2); R(g, '#f472b6', bx + 4, by + 8, 5, 2); R(g, '#f472b6', bx + 5, by + 10, 3, 1); R(g, '#f472b6', bx + 6, by + 11, 1, 1);
      R(g, '#fde047', bx + 11, by + 6, 2, 2);
      frame(g, bx + 17, by + 3, 14, 12, '#22d3ee', '#0f172a');
      R(g, '#9ca3af', bx + 20, by + 7, 8, 4); R(g, '#1f2937', bx + 21, by + 8, 1, 2); R(g, '#1f2937', bx + 20, by + 9, 3, 0 + 1); R(g, '#ef4444', bx + 25, by + 8, 1, 1); R(g, '#22c55e', bx + 26, by + 9, 1, 1);
    },
    vinilo(g, bx, by) {
      frame(g, bx + 1, by + 3, 14, 12, '#facc15', '#fef9c3');
      R(g, '#111827', bx + 5, by + 5, 6, 8); R(g, '#111827', bx + 4, by + 6, 8, 6); R(g, '#ef4444', bx + 7, by + 8, 2, 2); R(g, '#374151', bx + 5, by + 6, 1, 1);
    },
    chart(g, bx, by) {
      frame(g, bx + 1, by + 3, 30, 12, '#334155', '#f8fafc');
      [3, 5, 4, 7, 6, 8].forEach((h, i) => R(g, i === 5 ? '#22c55e' : '#3b82f6', bx + 5 + i * 4, by + 13 - h, 3, h));
      R(g, '#ef4444', bx + 24, by + 5, 4, 1); R(g, '#ef4444', bx + 27, by + 5, 1, 3);
    },
    diploma(g, bx, by) {
      frame(g, bx + 1, by + 3, 14, 12, '#a16207', '#fffbeb');
      R(g, '#94a3b8', bx + 4, by + 6, 8, 1); R(g, '#94a3b8', bx + 4, by + 8, 6, 1); R(g, '#dc2626', bx + 10, by + 10, 3, 3); R(g, '#fbbf24', bx + 11, by + 11, 1, 1);
    },
    notas(g, bx, by) {
      const cols = ['#fde68a', '#f9a8d4', '#a7f3d0', '#bfdbfe', '#fde68a', '#fdba74'];
      cols.forEach((c, i) => { const x = bx + 2 + i * 5, y = by + 4 + (i % 2) * 4; R(g, OUT, x - 1, y - 1, 6, 6); R(g, c, x, y, 4, 4); R(g, tone(c, -0.2), x, y + 3, 4, 1); });
    },
    notas2(g, bx, by) {
      ['#a7f3d0', '#fde68a', '#f9a8d4'].forEach((c, i) => { const x = bx + 2 + (i % 2) * 6, y = by + 4 + i * 3; R(g, OUT, x - 1, y - 1, 7, 6); R(g, c, x, y, 5, 4); });
    },
    painting(g, bx, by) {
      frame(g, bx + 1, by + 3, 30, 12, '#b45309', '#93c5fd');
      R(g, '#fde68a', bx + 22, by + 5, 3, 3);
      for (let x = 0; x < 26; x++) { const h = Math.round(4 + Math.sin(x / 3) * 2 + (x > 12 ? 2 : 0)); R(g, x > 14 ? '#64748b' : '#475569', bx + 3 + x, by + 13 - h, 1, h); }
      R(g, '#4ade80', bx + 3, by + 11, 26, 2); R(g, '#f8fafc', bx + 9, by + 6, 2, 1);
    },
    calendar(g, bx, by) {
      frame(g, bx + 2, by + 3, 12, 12, '#e2e8f0', '#ffffff');
      R(g, '#ef4444', bx + 3, by + 4, 10, 3);
      const d = new Date().getDate();
      for (let i = 0; i < 12; i++) R(g, i === (d % 12) ? '#ef4444' : '#cbd5e1', bx + 4 + (i % 4) * 2, by + 8 + Math.floor(i / 4) * 2, 1, 1);
    },
    window(g, bx, by) {
      R(g, OUT, bx + 1, by + 3, 14, 12); R(g, '#f1e7d4', bx + 2, by + 4, 12, 10);
      R(g, '#d9cbb0', bx, by + 14, 16, 2); R(g, '#f1e7d4', bx, by + 14, 16, 1);
    },
    clock(g, bx, by) {
      const rows = [3, 5, 7, 7, 7, 7, 7, 5, 3];
      rows.forEach((w, i) => R(g, OUT, bx + 8 - Math.floor(w / 2) - 1, by + 4 + i, w + 2, 1));
      R(g, OUT, bx + 6, by + 3, 5, 1); R(g, OUT, bx + 6, by + 13, 5, 1);
      rows.forEach((w, i) => R(g, i === 0 || i === 8 ? '#e2e8f0' : '#f8fafc', bx + 8 - Math.floor(w / 2), by + 4 + i, w, 1));
      R(g, '#94a3b8', bx + 8, by + 5, 1, 1); R(g, '#94a3b8', bx + 8, by + 12, 1, 1); R(g, '#94a3b8', bx + 5, by + 8, 1, 1); R(g, '#94a3b8', bx + 11, by + 8, 1, 1);
    },
    sconce(g, bx, by) { R(g, OUT, bx + 6, by + 9, 4, 5); R(g, '#a16207', bx + 7, by + 10, 2, 3); },
  };

  /** Dibuja en la capa fija los objetos nuevos. Devuelve true si se encargó del objeto. */
  function drawFixed(g, o) {
    const bx = o.x * 16, by = o.y * 16;
    if (o.kind === 'plant') { SPR.plantPot(g, bx, by); return true; }
    if (o.kind !== 'deco') return false;
    const f = ITEMS[o.item];
    if (f) f(g, bx, by, o);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Hora del día y luz                                                   */
  /* ------------------------------------------------------------------ */

  const forced = (() => { const m = /[?&]hora=(\d+(?:\.\d+)?)/.exec(location.search); return m ? Number(m[1]) % 24 : null; })();
  const hourNow = () => { if (forced != null) return forced; const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  // hora, luz exterior, luz interior, lámparas encendidas (0 a 1)
  const KEYS = [
    [0, '#2f3a78', '#a99fbe', 1], [5, '#2f3a78', '#a99fbe', 1], [6.4, '#b78aa8', '#e2cfd2', 0.65], [7.8, '#ffeedd', '#fff6ea', 0.15],
    [9.5, '#ffffff', '#ffffff', 0], [16.4, '#ffffff', '#ffffff', 0], [17.6, '#ffc994', '#ffe8d2', 0.35], [18.5, '#d08a80', '#f1d3c2', 0.7],
    [19.4, '#4d4f90', '#bdb3cc', 0.95], [20.6, '#2f3a78', '#a99fbe', 1], [24, '#2f3a78', '#a99fbe', 1],
  ];
  const SKY = [
    [0, '#0b1030', '#1e2a5a'], [5, '#0b1030', '#1e2a5a'], [6.3, '#3b3f7a', '#f29e8e'], [7.5, '#7fb8f0', '#ffd8a8'], [9.5, '#5fb2ff', '#bfe6ff'],
    [16.4, '#5fb2ff', '#bfe6ff'], [17.7, '#5b6ec9', '#ffb070'], [18.7, '#3a2f6b', '#ff7a59'], [19.7, '#141a44', '#3b3d7a'], [24, '#0b1030', '#1e2a5a'],
  ];
  function lerpKeys(keys, h) {
    let i = 0; while (i < keys.length - 2 && h >= keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1], k = Math.max(0, Math.min(1, (h - a[0]) / (b[0] - a[0] || 1)));
    return a.slice(1).map((v, j) => (typeof v === 'number' ? v + (b[j + 1] - v) * k : mix(v, b[j + 1], k)));
  }
  let dayCache = null;
  function day() {
    const now = Date.now();
    if (dayCache && now - dayCache.at < 15000) return dayCache;
    const h = hourNow();
    const [outdoor, indoor, lamps] = lerpKeys(KEYS, h);
    const [skyTop, skyBottom] = lerpKeys(SKY, h);
    const q = c => mix(c, c, 0); // normaliza
    dayCache = { at: now, h, outdoor: q(outdoor), indoor: q(indoor), lamps, skyTop, skyBottom,
      plain: outdoor === '#ffffff' && indoor === '#ffffff' && lamps < 0.02,
      emoji: h < 5 || h >= 19.6 ? '🌙' : h < 7.5 ? '🌅' : h < 17.2 ? '☀️' : '🌇' };
    return dayCache;
  }

  /** Luz con forma de píxeles: anillos escalonados con un poco de tramado. */
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function glow(color, r) {
    return memo(`g|${color}|${r}`, () => {
      const s = r * 2, c = mk(s, s), g = c.getContext('2d');
      const img = g.createImageData(s, s);
      const n = parseInt(color.slice(1), 16);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
        if (d >= 1) continue;
        const a = (1 - d) * (1 - d) * (1 + d);
        const lvl = Math.min(4, Math.floor(a * 4 + BAYER[(y % 4) * 4 + (x % 4)] / 16)) / 4;
        if (!lvl) continue;
        const i = (y * s + x) * 4;
        img.data[i] = (n >> 16) & 255; img.data[i + 1] = (n >> 8) & 255; img.data[i + 2] = n & 255; img.data[i + 3] = Math.round(lvl * 255);
      }
      g.putImageData(img, 0, 0);
      return c;
    });
  }

  const lightsOf = new WeakMap();
  function lightList(m) {
    let L = lightsOf.get(m);
    if (L) return L;
    L = { fixed: [], desks: [], windows: [] };
    const add = (x, y, r, color, k) => L.fixed.push({ x, y, r, color, k });
    for (const r of m.rooms) {
      add((r.x0 + 4) * 16 + 8, (r.y0 + 4) * 16 + 12, 46, '#ffd9a0', 0.5);
      add((r.x0 + 11) * 16 + 8, (r.y0 + 4) * 16 + 12, 46, '#ffd9a0', 0.5);
    }
    for (const [x, y] of [[3.5, 9], [8.5, 9], [3.5, 14], [8.5, 14]]) add(x * 16, y * 16, 44, '#ffdcae', 0.55);
    for (let x = 14; x < m.W - 1; x += 5) add(x * 16 + 8, 11.5 * 16, 40, '#ffe0b0', 0.45);
    for (const o of m.objects) {
      if (o.kind === 'desk') L.desks.push(o);
      else if (o.item === 'sconce') add(o.x * 16 + 8, o.y * 16 + 14, 30, '#ffbe6b', 0.75);
      else if (o.item === 'floorlamp') add(o.x * 16 + 8, o.y * 16 - 6, 40, '#ffcf7a', 0.95);
      else if (o.item === 'puff') add(o.x * 16 + 8, o.y * 16 - 4, 34, '#ffcf7a', 0.8);
      else if (o.item === 'window') L.windows.push(o);
      else if (o.kind === 'reception') add(o.x * 16 + 6, (o.y + 1) * 16 - 8, 30, '#ffd27a', 0.8);
      else if (o.kind === 'xtree') add((o.x + 1) * 16, (o.y + 1) * 16, 42, '#ffb86b', 0.9);
      else if (o.item === 'rack' || o.item === 'ups') add(o.x * 16 + 8, o.y * 16 + 8, 22, '#5eead4', 0.45);
      else if (o.item === 'arcade') add(o.x * 16 + 8, o.y * 16 + 4, 26, '#c084fc', 0.6);
    }
    for (const l of m.outdoor?.lamps || []) add(l.x * 16 + 8, l.y * 16 - 10, 48, '#ffd88a', 1);
    lightsOf.set(m, L);
    return L;
  }
  function footprint(m, color) {
    return memo(`f|${m.W}x${m.H}|${color}|${m.sig || ''}`, () => {
      const c = mk(m.W, m.H), g = c.getContext('2d');
      g.fillStyle = color;
      for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) if (tAt(m, x, y) !== VOIDT) g.fillRect(x, y, 1, 1);
      return c;
    });
  }

  let lightCanvas = null, lightCtx = null;
  function lighting(c, time) {
    const d = day();
    if (d.plain) return;
    const vw = Math.ceil(canvas.width / SCALE) + 2, vh = Math.ceil(canvas.height / SCALE) + 2;
    if (!lightCanvas || lightCanvas.width !== vw || lightCanvas.height !== vh) {
      lightCanvas = mk(vw, vh); lightCtx = lightCanvas.getContext('2d');
    }
    const g = lightCtx, ox = Math.floor(cam.x), oy = Math.floor(cam.y);
    if (!map.sig) map.sig = Math.random().toString(36).slice(2);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.imageSmoothingEnabled = false;
    g.fillStyle = d.outdoor; g.fillRect(0, 0, vw, vh);
    g.drawImage(footprint(map, d.indoor), -ox, -oy, map.W * 16, map.H * 16);
    g.globalCompositeOperation = 'lighter';
    const L = lightList(map);
    const inView = (x, y, r) => x + r > ox && x - r < ox + vw && y + r > oy && y - r < oy + vh;
    const lamp = d.lamps;
    if (lamp > 0.02) {
      for (const l of L.fixed) {
        if (!inView(l.x, l.y, l.r)) continue;
        g.globalAlpha = Math.min(1, l.k * lamp);
        g.drawImage(glow(l.color, l.r), Math.round(l.x - l.r - ox), Math.round(l.y - l.r - oy));
      }
    }
    // Pantallas: iluminan la cara y la mesa con su color
    for (const o of L.desks) {
      const t = threadById.get(o.thread);
      if (!t || t.status === 'dormido') continue;
      const x = o.x * 16 + 22, y = o.y * 16 + 10;
      if (!inView(x, y, 24)) continue;
      g.globalAlpha = 0.25 + 0.55 * lamp;
      g.drawImage(glow(STATUS[t.status].screen, 24), x - 24 - ox, y - 24 - oy);
    }
    // Luz de las ventanas sobre el piso
    const sun = 1 - lamp;
    for (const o of L.windows) {
      const x = o.x * 16, y = (o.y + 1) * 16;
      if (!inView(x, y, 48)) continue;
      g.globalAlpha = lamp > 0.8 ? 0.22 : 0.35 * (0.3 + sun);
      g.fillStyle = lamp > 0.8 ? '#7d8ad8' : d.skyBottom;
      g.beginPath();
      g.moveTo(x + 2 - ox, y - oy); g.lineTo(x + 14 - ox, y - oy); g.lineTo(x + 20 - ox, y + 26 - oy); g.lineTo(x + 6 - ox, y + 26 - oy);
      g.fill();
    }
    // Luces navideñas de las guirnaldas
    if (XMAS && map.faces && lamp > 0.2) {
      const blink = Math.floor(time / 450);
      g.globalAlpha = 0.5 * lamp;
      for (const f of map.faces) {
        if (!inView(f.x * 16, f.y * 16, 20)) continue;
        for (const k of [3, 11]) {
          const i = f.x * 2 + (k > 8 ? 1 : 0) + f.y;
          if ((blink + i) % 4 === 0) continue;
          g.drawImage(glow(LIGHTS[i % LIGHTS.length], 7), f.x * 16 + k - 6 - ox, f.y * 16 + 3 - oy);
        }
      }
    }
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.drawImage(lightCanvas, ox, oy);
    c.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Partes animadas de la decoración                                     */
  /* ------------------------------------------------------------------ */

  function frondsPalm(c, bx, by, time, seed) {
    const cx = bx + 8, cy = by + 6;
    const sway = Math.sin(time / 1400 + seed) * 0.12;
    const fr = [-2.6, -2.1, -1.6, -1.05, -0.55, -0.1];
    fr.forEach((a0, i) => {
      const a = a0 + sway * (1 + i * 0.15), len = 11 + (i % 2) * 2;
      for (let s = 0; s <= len; s++) {
        const px = Math.round(cx + Math.cos(a) * s), py = Math.round(cy + Math.sin(a) * s + (s * s) / (len * 1.6));
        R(c, OUT, px - 1, py - 1, 3, 3);
      }
      for (let s = 0; s <= len; s++) {
        const px = Math.round(cx + Math.cos(a) * s), py = Math.round(cy + Math.sin(a) * s + (s * s) / (len * 1.6));
        R(c, s % 3 === 0 ? '#2f8a3f' : '#46b05a', px, py, 1, 1); if (s > 2 && s < len - 1) R(c, '#2f8a3f', px, py + 1, 1, 1);
      }
    });
    R(c, OUT, cx - 2, cy - 2, 5, 4); R(c, '#7c522a', cx - 1, cy - 1, 3, 2);
    if (!XMAS) { R(c, OUT, cx - 3, cy + 1, 3, 3); R(c, '#a16207', cx - 2, cy + 2, 1, 1); R(c, OUT, cx + 1, cy + 1, 3, 3); R(c, '#a16207', cx + 2, cy + 2, 1, 1); }
    else { R(c, '#ef4444', cx - 2, cy + 2, 2, 2); R(c, '#ffd166', cx + 1, cy + 2, 2, 2); }
  }
  function leavesFicus(c, bx, by, time, seed, tall) {
    const s = Math.sin(time / 1300 + seed);
    const D = '#2f7a3f', M = '#4caf63', L = '#86d993';
    const blobs = tall ? [[2, 8, 6, 5, 1], [9, 6, 6, 5, 1], [4, 2, 8, 6, 2], [1, 13, 5, 4, 0.5], [10, 12, 5, 4, 0.5], [5, -3, 6, 5, 2.5]] : [];
    for (const [x, y, w, h, k] of blobs) {
      const o = Math.round(s * k * 0.7);
      R(c, OUT, bx + x - 1 + o, by + y - 1, w + 2, h + 2);
    }
    for (const [x, y, w, h, k] of blobs) {
      const o = Math.round(s * k * 0.7);
      R(c, M, bx + x + o, by + y, w, h); R(c, D, bx + x + o, by + y + h - 1, w, 1); R(c, L, bx + x + o + 1, by + y, w - 2, 1);
    }
  }
  function drawAnimated(c, o, time) {
    const bx = o.x * 16, by = o.y * 16, d = day();
    switch (o.item) {
      case 'palm': frondsPalm(c, bx, by, time, o.seed || 0); break;
      case 'ficus': leavesFicus(c, bx, by, time, o.seed || 0, true); break;
      case 'ficusSmall': SPR.plantLeaves(c, bx, by, time, o.seed || 0); break;
      case 'rack':
        for (let i = 0; i < 7; i++) for (let j = 0; j < 3; j++) {
          const on = rnd(i + o.x, j + Math.floor(time / (180 + j * 90))) > 0.35;
          R(c, on ? (j === 2 ? '#fbbf24' : '#4ade80') : '#14532d', bx + 4 + j * 2, by - 1 + i * 5, 1, 1);
        }
        break;
      case 'ups': R(c, Math.floor(time / 700) % 2 ? '#4ade80' : '#166534', bx + 5, by + 9, 2, 1); R(c, '#60a5fa', bx + 8, by + 9, 3, 1); break;
      case 'arcade': {
        const t = Math.floor(time / 160);
        R(c, '#0f172a', bx + 4, by, 8, 7);
        R(c, ['#f472b6', '#22d3ee', '#facc15'][t % 3], bx + 4 + (t % 6), by + 2, 2, 2);
        R(c, '#4ade80', bx + 4, by + 5, 8, 1); R(c, '#ffffff', bx + 4 + ((t * 2) % 8), by + 4, 1, 1);
        break;
      }
      case 'printer': {
        const k = Math.round((Math.sin(time / 300) + 1) * 4);
        R(c, '#475569', bx + 3, by + 4, 10, 1); R(c, '#ef4444', bx + 3 + k, by + 5, 2, 3);
        R(c, '#f472b6', bx + 6, by + 10, 4, 2);
        break;
      }
      case 'pantalla': {
        const off = Math.floor(time / 300);
        for (let i = 0; i < 12; i++) { const h = 2 + Math.round(3 * (0.5 + 0.5 * Math.sin((i + off) * 0.8))); R(c, i % 4 === 0 ? '#fbbf24' : '#22d3ee', bx + 4 + i * 2, by + 13 - h, 1, h); }
        R(c, '#4ade80', bx + 4, by + 6, 6, 1); R(c, Math.floor(time / 500) % 2 ? '#4ade80' : '#0b1220', bx + 11, by + 6, 1, 1);
        break;
      }
      case 'puff':
        if (d.lamps > 0.3) { c.save(); c.globalAlpha = 0.5; R(c, '#fff7cc', bx + 5, by - 6, 6, 3); c.restore(); }
        break;
      case 'sconce': {
        const on = d.lamps > 0.25;
        R(c, OUT, bx + 4, by + 5, 8, 6); R(c, on ? '#fde68a' : '#e7d8b0', bx + 5, by + 6, 6, 4); R(c, on ? '#fff7cc' : '#f4ead2', bx + 6, by + 6, 2, 1);
        if (on) { c.save(); c.globalAlpha = 0.35; R(c, '#fde68a', bx + 3, by + 10, 10, 3); c.restore(); }
        break;
      }
      case 'window': {
        const x = bx + 2, y = by + 4;
        const top = d.skyTop, bot = d.skyBottom;
        R(c, top, x, y, 12, 4); R(c, mix(top, bot, 0.5), x, y + 4, 12, 3); R(c, bot, x, y + 7, 12, 3);
        if (d.lamps > 0.8) { // estrellas y luna
          for (let i = 0; i < 4; i++) R(c, '#ffffff', x + Math.floor(rnd(o.x, i) * 12), y + Math.floor(rnd(i, o.x) * 7), 1, 1);
          if (o.x % 3 === 0) { R(c, '#fef9c3', x + 7, y + 1, 3, 3); R(c, top, x + 8, y + 1, 2, 2); }
        } else if (d.lamps < 0.4) { // nube que pasa
          const k = ((time / 9000 + o.x * 0.37) % 1) * 18 - 4;
          R(c, '#ffffff', Math.round(x + k), y + 2, 4, 1); R(c, '#ffffff', Math.round(x + k) + 1, y + 1, 2, 1);
        }
        if (XMAS) { R(c, '#ffffff', x, y + 9, 12, 1); R(c, '#e0f2fe', x, y, 2, 1); R(c, '#e0f2fe', x + 10, y, 2, 1); }
        R(c, '#e7dcc8', x + 5, y, 2, 10); R(c, '#e7dcc8', x, y + 4, 12, 1);
        R(c, 'rgba(255,255,255,.35)', x + 1, y + 1, 1, 2);
        break;
      }
      case 'clock': {
        const h = hourNow(), cx = bx + 8, cy = by + 8;
        const hand = (ang, len, col) => { for (let s = 1; s <= len; s++) R(c, col, Math.round(cx + Math.sin(ang) * s), Math.round(cy - Math.cos(ang) * s)); };
        hand(((h % 12) / 12) * Math.PI * 2, 2, OUT);
        hand(((h % 1) * Math.PI * 2), 3, '#ef4444');
        R(c, OUT, cx, cy);
        break;
      }
      default: break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Puertas corredizas                                                   */
  /* ------------------------------------------------------------------ */

  let lastT = 0, dtCache = 0;
  function doors(c, time, view) {
    const ptx = player.fx + (player.tx - player.fx) * player.t + 0.5, pty = player.fy + (player.ty - player.fy) * player.t + 0.5;
    for (const r of map.rooms) {
      const x = (r.x0 + 7) * 16, y = r.doorY * 16;
      const dist = Math.max(Math.abs(ptx - (r.x0 + 8)), Math.abs(pty - (r.doorY + 0.5)));
      const target = dist < 2.7 ? 1 : 0;
      r._door = (r._door ?? 0) + (target - (r._door ?? 0)) * Math.min(1, dtCache * 9);
      if (x + 32 < view.x0 || x > view.x1 || y + 16 < view.y0 || y > view.y1) continue;
      const off = Math.round(r._door * 15);
      R(c, '#4a2a18', x - 1, y, 34, 2);
      c.save(); c.beginPath(); c.rect(x, y + 2, 32, 13); c.clip();
      const glass = tone(r.accent, 0.62), fr = tone(r.accent, -0.35);
      for (const [px, side] of [[x - off, -1], [x + 16 + off, 1]]) {
        R(c, OUT, px, y + 2, 16, 13); R(c, fr, px + 1, y + 2, 14, 12); R(c, glass, px + 3, y + 4, 10, 8);
        R(c, '#ffffff', px + 4, y + 5, 1, 3); R(c, '#ffffff', px + 5, y + 4, 1, 1);
        R(c, '#ffd166', side < 0 ? px + 13 : px + 2, y + 8, 1, 2);
      }
      c.restore();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Confeti y celebraciones                                              */
  /* ------------------------------------------------------------------ */

  const parts = [];
  const celebrations = new Map(); // id del hilo -> { t0, spawned }
  const CONF = ['#f472b6', '#facc15', '#4ade80', '#60a5fa', '#fb923c', '#c084fc', '#ffffff'];
  function burst(x, y, n = 48) {
    for (let i = 0; i < n; i++) {
      parts.push({ x, y, vx: (Math.random() - 0.5) * 90, vy: -50 - Math.random() * 80, life: 2.2 + Math.random() * 1.4, t: 0,
        col: CONF[i % CONF.length], spin: Math.random() * 6, star: i % 7 === 0 });
    }
  }
  function isCelebrating(id) { const c = celebrations.get(id); return Boolean(c && performance.now() - c.t0 < 7000); }
  function celebrate(id) {
    celebrations.set(id, { t0: performance.now(), spawned: false });
  }
  /** Compara con el refresco anterior: si un hilo llegó al 100 %, ¡fiesta! */
  function onWorld(prev, next) {
    if (!prev || !next) return;
    const old = new Map();
    for (const p of prev.projects) for (const t of p.threads) old.set(t.id, t);
    for (const p of next.projects) for (const t of p.threads) {
      const o = old.get(t.id);
      if (o && t.total > 0 && t.done === t.total && o.done < o.total) {
        celebrate(t.id);
        if (typeof toast === 'function') toast(`🎉 «${cut(t.title, 40)}» completó su lista (${t.done}/${t.total})`, 'ok', 6000);
      }
    }
  }
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t > p.life) { parts.splice(i, 1); continue; }
      p.vy += 140 * dt; p.vx *= 1 - 1.2 * dt; p.vy = Math.min(p.vy, 38);
      p.x += p.vx * dt + Math.sin(p.t * 7 + p.spin) * 0.25; p.y += p.vy * dt;
    }
  }
  function drawParts(c, time) {
    for (const p of parts) {
      c.globalAlpha = Math.min(1, (p.life - p.t) * 1.5);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.star) SPR.sparkle(x, y, p.col, 1);
      else R(c, p.col, x, y, Math.abs(Math.sin(p.t * 9 + p.spin)) > 0.5 ? 2 : 1, 1 + (Math.floor(p.t * 9 + p.spin) % 2));
    }
    c.globalAlpha = 1;
    for (const [id, cel] of celebrations) {
      const age = performance.now() - cel.t0;
      if (age > 7000) { celebrations.delete(id); continue; }
      const o = map.objects.find(x => x.kind === 'desk' && x.thread === id);
      if (!o) continue;
      if (!cel.spawned) { cel.spawned = true; burst(o.x * 16 + 16, o.y * 16 - 2); burst(o.x * 16 + 16, o.y * 16 - 2, 20); }
      if (age < 4500) label('¡100 %! 🎉', o.x * 16 + 16, o.y * 16 - 26 - Math.round(Math.sin(age / 180) * 2), { size: 7, color: '#1e1b4b', bg: 'rgba(255,209,102,.95)' });
    }
    void time;
  }

  /* ------------------------------------------------------------------ */
  /* Ganchos del bucle de dibujo                                          */
  /* ------------------------------------------------------------------ */

  let animCacheMap = null, animList = [];
  function viewRect() {
    const vw = canvas.width / SCALE, vh = canvas.height / SCALE;
    return { x0: cam.x - 40, y0: cam.y - 48, x1: cam.x + vw + 40, y1: cam.y + vh + 48 };
  }
  let lastCam = null, fade = null;
  function beforeWorld(c, time) {
    const now = performance.now();
    dtCache = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
    lastT = now;
    const vw = canvas.width / SCALE, vh = canvas.height / SCALE;
    c.fillStyle = XMAS ? '#eef3fa' : '#6fbf5a';
    c.fillRect(Math.floor(cam.x) - 2, Math.floor(cam.y) - 2, Math.ceil(vw) + 4, Math.ceil(vh) + 4);
    // Salto de cámara (teletransporte desde el directorio o el minimapa): fundido suave
    if (lastCam && Math.hypot(cam.x - lastCam.x, cam.y - lastCam.y) > 90 && !fade) fade = { t0: now, dur: 380 };
    lastCam = { x: cam.x, y: cam.y };
    void time;
  }
  function afterStatic(c, time) {
    if (animCacheMap !== map) {
      animCacheMap = map;
      animList = map.objects.filter(o => (o.kind === 'deco' && o.anim) || o.kind === 'plant');
    }
    const v = viewRect();
    for (const o of animList) {
      const x = o.x * 16, y = o.y * 16;
      if (x + o.w * 16 < v.x0 || x > v.x1 || y + o.h * 16 < v.y0 || y > v.y1) continue;
      if (o.kind === 'plant') SPR.plantLeaves(c, x, y, time, o.x * 7 + o.y);
      else drawAnimated(c, o, time);
    }
    doors(c, time, v);
  }
  function afterWorld(c, time) {
    lighting(c, time);
    updateParts(dtCache);
    drawParts(c, time);
  }
  let iris = null;
  function overlay(c, time) {
    const now = performance.now();
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (iris) {
      const k = (now - iris.t0) / iris.dur;
      if (k >= 1) iris = null;
      else {
        const px2 = (player.fx + (player.tx - player.fx) * player.t) * 16 + 8, py2 = (player.fy + (player.ty - player.fy) * player.t) * 16;
        const sx = (px2 - cam.x) * SCALE, sy = (py2 - cam.y) * SCALE;
        const maxR = Math.hypot(canvas.width, canvas.height);
        const e = 1 - Math.pow(1 - k, 3);
        const r = Math.round((0.14 + 0.86 * e) * maxR / (SCALE * 4)) * SCALE * 4;
        c.fillStyle = 'rgba(14,10,30,.94)';
        c.beginPath(); c.rect(0, 0, canvas.width, canvas.height); c.arc(sx, sy, r, 0, Math.PI * 2, true); c.fill('evenodd');
      }
    }
    if (fade) {
      const k = (now - fade.t0) / fade.dur;
      if (k >= 1) fade = null;
      else { c.globalAlpha = 1 - k; c.fillStyle = '#0e0a1e'; c.fillRect(0, 0, canvas.width, canvas.height); }
    }
    c.restore();
    void time;
  }

  /* ------------------------------------------------------------------ */
  /* Al entrar a una oficina: cartel con el nombre y apertura en círculo  */
  /* ------------------------------------------------------------------ */

  let lastRoom = null;
  const banner = document.createElement('div');
  banner.className = 'cartel-oficina';
  banner.setAttribute('aria-hidden', 'true');
  document.body.append(banner);
  function enterRoom(r) {
    const prev = lastRoom;
    lastRoom = r;
    if (r === prev || r < 0 || !map?.rooms[r]) return;
    const room = map.rooms[r];
    const th = THEMES[room.theme] || THEMES.generico;
    if (!fade) iris = { t0: performance.now(), dur: 560 };
    banner.innerHTML = `<span class="em">${th.emoji}</span><b>${esc(room.name)}</b><small>${esc(th.label)}</small>`;
    banner.style.setProperty('--acento', room.accent);
    banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
    clearTimeout(enterRoom.timer); enterRoom.timer = setTimeout(() => banner.classList.remove('show'), 2700);
  }

  /* ------------------------------------------------------------------ */
  /* Minimapa                                                             */
  /* ------------------------------------------------------------------ */

  const mm = document.createElement('div');
  mm.className = 'minimapa';
  mm.innerHTML = '<div class="mm-head"><span>🗺️ MAPA</span><button class="mm-x" type="button" title="Ocultar el minimapa (N)" aria-label="Ocultar el minimapa">✕</button></div><canvas aria-label="Minimapa: haz clic en una oficina para ir"></canvas>';
  const mmShow = document.createElement('button');
  mmShow.className = 'pixel-btn mm-show'; mmShow.type = 'button'; mmShow.textContent = '🗺️'; mmShow.title = 'Mostrar el minimapa (N)';
  document.body.append(mm, mmShow);
  const mmCanvas = mm.querySelector('canvas'), mmCtx = mmCanvas.getContext('2d');
  let mmHidden = false;
  try { mmHidden = localStorage.getItem('oficina-minimapa') === 'oculto'; } catch {}
  function setMinimap(hidden) {
    mmHidden = hidden;
    mm.hidden = hidden; mmShow.hidden = !hidden;
    try { localStorage.setItem('oficina-minimapa', hidden ? 'oculto' : 'visible'); } catch {}
    if (!hidden) drawMinimap();
  }
  mm.querySelector('.mm-x').addEventListener('click', () => setMinimap(true));
  mmShow.addEventListener('click', () => setMinimap(false));
  addEventListener('keydown', ev => {
    if (ev.code !== 'KeyN' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (typeof modalOpen !== 'undefined' && modalOpen) return;
    if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
    setMinimap(!mmHidden);
  });
  let mmBase = null, mmBaseMap = null, mmK = 2;
  function mmBuild() {
    mmK = Math.max(1, Math.min(4, Math.floor(232 / map.W)));
    const c = mk(map.W * mmK, map.H * mmK), g = c.getContext('2d');
    for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
      const t = tAt(map, x, y), ri = map.roomOf[y * map.W + x];
      let col = null;
      if (t === FLOORT || (t === DOORT && ri >= 0)) col = tone(map.rooms[ri]?.accent || '#888888', 0.35);
      else if (t === CORRT || t === DOORT) col = '#d4cde0';
      else if (t === LOBBYT) col = '#f1e6cf';
      else if (t === WALLT) col = '#3d3458';
      else col = XMAS ? '#e6edf7' : '#5fae4c';
      g.fillStyle = col; g.fillRect(x * mmK, y * mmK, mmK, mmK);
    }
    for (const o of map.objects) if (o.kind === 'reception') { g.fillStyle = '#a8714c'; g.fillRect(o.x * mmK, o.y * mmK, o.w * mmK, o.h * mmK); }
    mmBase = c; mmBaseMap = map;
    mmCanvas.width = c.width; mmCanvas.height = c.height;
    const css = c.width < 150 ? 2 : 1;
    mmCanvas.style.width = `${c.width * css}px`;
  }
  function drawMinimap() {
    if (mmHidden || typeof map === 'undefined' || !map) return;
    if (mmBaseMap !== map) mmBuild();
    const g = mmCtx, k = mmK, now = performance.now();
    g.imageSmoothingEnabled = false;
    g.drawImage(mmBase, 0, 0);
    for (const o of map.objects) {
      if (o.kind !== 'desk') continue;
      const t = threadById.get(o.thread);
      if (!t) continue;
      if (t.status === 'espera' && Math.floor(now / 400) % 2) continue;
      g.fillStyle = STATUS[t.status]?.color || '#94a3b8';
      g.fillRect(o.x * k, (o.y + 1) * k, Math.max(2, 2 * k), Math.max(1, k));
    }
    const vw = canvas.width / SCALE / 16, vh = canvas.height / SCALE / 16;
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1;
    g.strokeRect(Math.round((cam.x / 16) * k) + 0.5, Math.round((cam.y / 16) * k) + 0.5, Math.round(vw * k) - 1, Math.round(vh * k) - 1);
    const px2 = (player.fx + (player.tx - player.fx) * player.t) * k, py2 = (player.fy + (player.ty - player.fy) * player.t) * k;
    g.fillStyle = OUT; g.fillRect(Math.round(px2) - 1, Math.round(py2) - 1, k + 2, k + 2);
    g.fillStyle = Math.floor(now / 300) % 2 ? '#ffffff' : (XMAS ? '#ef4444' : '#ff4d6d');
    g.fillRect(Math.round(px2), Math.round(py2), k, k);
  }
  mmCanvas.addEventListener('click', ev => {
    if (!map || (typeof modalOpen !== 'undefined' && modalOpen)) return;
    const rect = mmCanvas.getBoundingClientRect();
    const x = Math.floor(((ev.clientX - rect.left) / rect.width) * map.W), y = Math.floor(((ev.clientY - rect.top) / rect.height) * map.H);
    const ri = map.roomOf[y * map.W + x];
    if (ri >= 0) { const r = map.rooms[ri]; teleport(r.entry.x, r.entry.y, r.top ? 'up' : 'down'); }
    else if (ri === -10) teleport(6, 13, 'up');
    else if (ri === -20 && walkable(x, y)) teleport(x, y, 'down');
  });
  setInterval(drawMinimap, 200);
  setMinimap(mmHidden);

  /* ------------------------------------------------------------------ */
  /* Reloj en la barra de arriba y pista de teclas                        */
  /* ------------------------------------------------------------------ */

  const chip = document.createElement('span');
  chip.className = 'hud-hora';
  chip.title = 'Hora real: la luz de la oficina cambia con ella';
  document.getElementById('place')?.after(chip);
  function tickHud() {
    const d = day(), h = forced != null ? forced : null;
    const now = new Date();
    const hh = h != null ? Math.floor(h) : now.getHours(), mi = h != null ? Math.round((h % 1) * 60) : now.getMinutes();
    chip.textContent = `${d.emoji} ${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  tickHud(); setInterval(tickHud, 20000);
  const hint = document.getElementById('hint');
  if (hint && !/minimapa/.test(hint.textContent)) hint.insertAdjacentHTML('beforeend', ' · <b>N</b> minimapa');

  return { decorate, staticUnder, drawFixed, beforeWorld, afterStatic, afterWorld, overlay, enterRoom, onWorld, isCelebrating, celebrate, themeOf, THEMES, day };
})();
