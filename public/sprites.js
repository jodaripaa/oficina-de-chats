'use strict';
/* Oficina de chats — personajes dibujados con código (sin imágenes externas).
   Cada cuadro se pinta una vez en un lienzo pequeño y se reutiliza: así el juego sigue fluido
   aunque haya 60 escritorios. Usa las variables del juego (ctx, T, XMAS, STATUS, player,
   threadById, SHIRTS…) solo en el momento de dibujar, nunca al cargar. */
window.SPR = (() => {
  const OUT = '#2b1b3a';
  const cache = new Map();
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const R = (g, col, x, y, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const memo = (k, f) => {
    let v = cache.get(k);
    if (v === undefined) { if (cache.size > 4000) cache.clear(); v = f(); cache.set(k, v); }
    return v;
  };
  const hsh = s => { let a = 0; for (const c of String(s)) a = (a * 31 + c.charCodeAt(0)) | 0; return Math.abs(a); };
  function tone(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f).map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function mix(a, b, k) {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((x >> s) & 255) * (1 - k) + ((y >> s) & 255) * k);
    return '#' + [ch(16), ch(8), ch(0)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  /** Pinta un dibujo hecho con letras: cada letra es un color de la paleta, '.' es transparente. */
  function stamp(g, rows, pal, ox = 0, oy = 0) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const col = pal[row[x]];
        if (col) { g.fillStyle = col; g.fillRect(ox + x, oy + y, 1, 1); }
      }
    }
  }
  function flip(src) {
    const c = mk(src.width, src.height), g = c.getContext('2d');
    g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
    return c;
  }
  /** Sombra suave y redondeada (en píxeles) bajo personajes y muebles. */
  function shadow(g, cx, y, w, a = 0.22) {
    const x = Math.round(cx - w / 2);
    g.save(); g.globalAlpha = a; g.fillStyle = '#1a1030';
    g.fillRect(x + 2, y - 1, w - 4, 1); g.fillRect(x, y, w, 2); g.fillRect(x + 2, y + 2, w - 4, 1);
    g.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Jugador (normal y Santa): 4 direcciones, 3 cuadros de caminata       */
  /* ------------------------------------------------------------------ */

  const KID = {
    down: [
      '....kkkkkkkk....',
      '...khhLLhhhhk...',
      '..khhLhhhhhhhk..',
      '.khhhhhhhhhhhHk.',
      '.khhhhhhhhhhhHk.',
      '.khhsshhhssshHk.',
      '.khsssssssssshk.',
      '.khswessssweshk.',
      '.khseesssseeshk.',
      '.kssrssmmssrssk.',
      '..kzsssssssszk..',
      '..kkcczzzzcckk..',
      '.kcccccaaccccCk.',
      '.kclcccaaccccCk.',
      '.kcccCCCCCCccCk.',
      '.ksCCCCCCCCCCsk.',
      '..kkppppppppkk..',
    ],
    up: [
      '....kkkkkkkk....',
      '...khhLLhhhhk...',
      '..khhLhhhhhhhk..',
      '.khhhhhhhhhhhHk.',
      '.khhhhhhhhhhhHk.',
      '.khhhhhhhhhhhHk.',
      '.khhhhhhhhhhhHk.',
      '.kzhhhhhhhhhhzk.',
      '.kzhhhhhhhhhHzk.',
      '.kHhhhhhhhhhHHk.',
      '..kHHhhhhhhHHk..',
      '..kkcczzzzcckk..',
      '.kccCCCCCCCccCk.',
      '.kcccCCCCCcccCk.',
      '.kccccccccccCCk.',
      '.ksCCCCCCCCCCsk.',
      '..kkppppppppkk..',
    ],
    left: [
      '.....kkkkkkk....',
      '....khhLhhhhk...',
      '...khLhhhhhhhk..',
      '..khhhhhhhhhhHk.',
      '.khhhhhhhhhhhHk.',
      '.khsshhhhhhhhHk.',
      '.kssssshhhhhhHk.',
      '.ksesssshzhhhHk.',
      'kssesssszzhhhHk.',
      '.kmsrsssssshhHk.',
      '..kzsssssszhHk..',
      '...kkkzzzkkkk...',
      '...kccccccCCk...',
      '...kcclcccCCk...',
      '...kcccccCCCk...',
      '...kCCsCCCCCk...',
      '....kppppppk....',
    ],
  };
  const KID_PAL = {
    k: OUT, h: '#ffcf4a', H: '#e09a2a', L: '#fff1a6', s: '#ffd9b3', z: '#eeb68a', e: OUT, w: '#ffffff',
    r: '#ff9aa2', m: '#c2410c', c: '#ff4d6d', C: '#d6224a', l: '#ff9cb0', a: '#ffe4e6',
    p: '#3b5591', P: '#283d6b', f: '#f8fafc', F: '#a5b1c6',
  };
  const SANTA = {
    down: [
      '..........kkkk..',
      '.....kkkkkkWWWk.',
      '....kRRRRRRkWWk.',
      '...kRRRRRRRRkk..',
      '..kRRRRRRRRRRk..',
      '.kWWWWWWWWWWWWk.',
      '.kVWWWWWWWWWWVk.',
      '.ksssessssesssk.',
      '.ksrsssnnsssrsk.',
      '.ksWWWWWWWWWWsk.',
      '.kWWWWWmmWWWWWk.',
      '..kWWWWWWWWWWk..',
      '.kRkWWWWWWWWkRk.',
      '.kRRkVWWWWVkRRk.',
      '.kRRRRkWWkRRRDk.',
      '.kbbbbbggbbbbbk.',
      '.kBRRRRWWRRRRBk.',
      '..kWWWWWWWWWWk..',
    ],
    up: [
      '..........kkkk..',
      '.....kkkkkkWWWk.',
      '....kRRRRRRkWWk.',
      '...kRRRRRRRRkk..',
      '..kRRRRRRRRRRk..',
      '.kWWWWWWWWWWWWk.',
      '.kVWWWWWWWWWWVk.',
      '.kWWWWWWWWWWWWk.',
      '.kWWWWWWWWWWWVk.',
      '.kVWWWWWWWWWWVk.',
      '..kVWWWWWWWWVk..',
      '.kkkGGGGGGGGkkk.',
      '.kGGGGGyGGGGGGk.',
      '.kGGGGGGGGGGGQk.',
      '.kGGGGGGGGGGQQk.',
      '.kbbGGGGGGGGbbk.',
      '.kBRQQQQQQQQRBk.',
      '..kWWWWWWWWWWk..',
    ],
    left: [
      '..........kkkk..',
      '....kkkkkkkWWWk.',
      '...kRRRRRRRkWWk.',
      '..kRRRRRRRRRkk..',
      '.kRRRRRRRRRRRk..',
      'kWWWWWWWWWWWWk..',
      'kVWWWWWWWWWWVk..',
      '.ksesssssWWWWk..',
      'knssssrsWWWWWk..',
      '.kWWWWWWWWWWWk..',
      '.kWWmWWWWWWWVk..',
      '..kWWWWWWWWVk...',
      '...kWWWWWRRRk...',
      '...kVWWWRRRRDk..',
      '...kRWWRRRRRDk..',
      '...kbbbgbbbbbk..',
      '...kRRBRRRRRDk..',
      '....kWWWWWWWk...',
    ],
  };
  const SANTA_PAL = {
    k: OUT, R: '#dc2626', D: '#991b1b', W: '#f8fafc', V: '#cbd5e1', s: '#ffd6b0', e: OUT, r: '#ff8a8a',
    n: '#f06a6a', m: '#b91c1c', b: '#1f2937', g: '#ffd166', B: '#111827', G: '#9a6232', Q: '#74461f', y: '#ffd166',
    p: '#b91c1c', P: '#7f1d1d', f: '#1f2937', F: '#0b0f17',
  };

  /** Piernas de frente/espalda: largo de cada pierna según el paso. */
  function legsFront(g, top, step, pal) {
    const leg = (x, len, shade) => {
      for (let i = 0; i < len; i++) { R(g, pal.k, x, top + i); R(g, shade ? pal.P : pal.p, x + 1, top + i, 2, 1); R(g, pal.k, x + 3, top + i); }
      const y = top + len;
      R(g, pal.k, x, y); R(g, pal.f, x + 1, y, 2, 1); R(g, pal.k, x + 3, y);
      R(g, pal.k, x, y + 1, 4, 1);
    };
    const l = step === 1 ? 4 : step === 2 ? 2 : 3;
    const r = step === 1 ? 2 : step === 2 ? 4 : 3;
    leg(5, l, false); leg(9, r, true);
  }
  /** Piernas de perfil (mirando a la izquierda). */
  function legsSide(g, top, step, pal) {
    const leg = (x, len, shade) => {
      for (let i = 0; i < len; i++) { R(g, pal.k, x, top + i); R(g, shade ? pal.P : pal.p, x + 1, top + i, 2, 1); R(g, pal.k, x + 3, top + i); }
      const y = top + len;
      R(g, pal.k, x - 1, y); R(g, pal.f, x, y, 3, 1); R(g, pal.k, x + 3, y);
      R(g, pal.k, x - 1, y + 1, 5, 1);
    };
    if (step === 0) { leg(7, 3, true); leg(5, 3, false); }
    else if (step === 1) { leg(9, 2, true); leg(4, 3, false); }
    else { leg(4, 2, true); leg(8, 3, false); }
  }

  function playerFrame(santa, dir, step, blink) {
    return memo(`p|${santa ? 1 : 0}|${dir}|${step}|${blink ? 1 : 0}`, () => {
      const side = dir === 'left' || dir === 'right';
      const set = santa ? SANTA : KID, pal = santa ? SANTA_PAL : KID_PAL;
      const rows = set[side ? 'left' : dir];
      const c = mk(18, 26), g = c.getContext('2d');
      const top = rows.length;
      if (santa && side) { // saco de regalos a la espalda
        R(g, OUT, 12, 7, 6, 11); R(g, pal.G, 13, 8, 4, 9); R(g, pal.Q, 16, 8, 1, 9); R(g, pal.y, 13, 9, 4, 1); R(g, OUT, 14, 6, 2, 1);
      }
      if (side) legsSide(g, top, step, pal); else legsFront(g, top, step, pal);
      stamp(g, rows, pal, 1, 0);
      if (blink && dir === 'down') {
        const skin = pal.s;
        if (santa) { R(g, skin, 6, 7); R(g, skin, 11, 7); R(g, OUT, 5, 7, 2, 1); R(g, OUT, 10, 7, 2, 1); }
        else { R(g, skin, 5, 7, 2, 2); R(g, skin, 11, 7, 2, 2); R(g, OUT, 5, 8, 2, 1); R(g, OUT, 11, 8, 2, 1); }
      }
      const out = { c, anchor: top + 4 };
      if (dir === 'right') out.c = flip(c);
      return out;
    });
  }

  function drawPlayer(time) {
    const x = Math.round((player.fx + (player.tx - player.fx) * player.t) * T);
    const y = Math.round((player.fy + (player.ty - player.fy) * player.t) * T);
    const moving = player.t < 1 || player.path.length > 0;
    const step = player.t < 1 ? [1, 0, 2, 0][Math.floor(time / 115) % 4] : 0;
    const blink = !moving && (time % 3700) < 140;
    shadow(ctx, x + 8, y + 15, 12, 0.25);
    const f = playerFrame(XMAS, player.dir, step, blink);
    const bob = step ? -1 : 0; // rebote al dar el paso
    ctx.drawImage(f.c, x - 1, y + 16 - f.anchor + bob);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Trabajadores: cabezas, peinados, cuerpo y poses                      */
  /* ------------------------------------------------------------------ */

  const HAIR = [
    [ // corto con raya
      '............', '............', '...kkkkkk...', '..khhhhhhk..', '.khhhhhhhhk.', 'khhhhhhhhhHk', 'khhsssshhhHk',
      'khssssssshHk', 'kssssssssssk', 'kssssssssssk', 'kssssssssssk', '.kzsssssszk.', '..kkkkkkkk..', '............',
    ],
    [ // melena con flequillo
      '............', '............', '...kkkkkk...', '..khhhhhhk..', '.khhhhhhhhk.', 'khhhhhhhhhhk', 'khhhhhhhhhhk',
      'khsssssssshk', 'khsssssssshk', 'khsssssssshk', 'khsssssssshk', 'khkzsssszkhk', 'khhkkkkkkhhk', '.kk......kk.',
    ],
    [ // moño
      '....kkkk....', '...khhhHk...', '...kkkkkk...', '..khhhhhhk..', '.khhhhhhhhk.', 'khhhhhhhhhHk', 'khhsssssshHk',
      'khssssssssHk', 'kssssssssssk', 'kssssssssssk', 'kssssssssssk', '.kzsssssszk.', '..kkkkkkkk..', '............',
    ],
    [ // puntas
      '............', '.k...k...k..', '.kk.khk.khk.', '.khkhhhkhhk.', 'khhhhhhhhhhk', 'khhhhhhhhhHk', 'khhhshhhshHk',
      'khssssssssHk', 'kssssssssssk', 'kssssssssssk', 'kssssssssssk', '.kzsssssszk.', '..kkkkkkkk..', '............',
    ],
    [ // rizos
      '............', '..kk.kk.kk..', '.khhkhhkhhk.', 'khhHhhHhhHhk', 'khHhhHhhHhhk', 'khhhhhhhhhhk', 'khhssssssHhk',
      'khssssssssHk', 'khsssssssshk', 'khsssssssshk', 'kssssssssssk', '.kzsssssszk.', '..kkkkkkkk..', '............',
    ],
  ];
  const HAT = [
    '.......kkkk.', '....kkkkPPPk', '...kRRRkPPPk', '..kRRRRRkkk.', '.kRRRRRRRRk.', 'kWWWWWWWWWWk', 'kVWWWWWWWWVk',
  ];
  const HAT_PAL = {
    santa: { k: OUT, R: '#dc2626', P: '#f8fafc', W: '#f8fafc', V: '#cbd5e1' },
    elf: { k: OUT, R: '#16a34a', P: '#facc15', W: '#15803d', V: '#0f5f2f' },
  };
  const EYES = {
    normal: [[3, 8], [3, 9], [8, 8], [8, 9]],
    right: [[4, 8], [4, 9], [9, 8], [9, 9]],
    left: [[2, 8], [2, 9], [7, 8], [7, 9]],
    down: [[3, 9], [8, 9]],
    closed: [[2, 9], [3, 9], [8, 9], [9, 9]],
    happy: [[2, 9], [3, 8], [4, 9], [7, 9], [8, 8], [9, 9]],
  };
  const EXPR = {
    neutral: ['normal', 'smile'], blink: ['closed', 'smile'], focus: ['right', 'flat'], blinkFocus: ['closed', 'flat'],
    call: ['normal', 'open'], joy: ['happy', 'grin'], yawn: ['closed', 'o'], content: ['happy', 'smile'],
    down: ['down', 'smile'], sleep: ['closed', 'tiny'], lookRight: ['right', 'smile'], lookLeft: ['left', 'smile'],
  };

  const OUTFITS = ['plain', 'tie', 'stripes', 'hoodie', 'plain', 'vest'];
  function lookOf(id) {
    const seed = hsh(id), s2 = hsh(`${id}·look`);
    const style = s2 % HAIR.length;
    return {
      seed, key: `${seed}`,
      // Los colores salen igual que antes (mismo trabajador de siempre); el resto, de otra semilla.
      shirt: SHIRTS[seed % SHIRTS.length], skin: SKINS[(seed >> 3) % SKINS.length], hair: HAIRS[(seed >> 6) % HAIRS.length],
      style, glasses: ((s2 >> 4) & 3) === 0, outfit: OUTFITS[(s2 >> 7) % OUTFITS.length],
      beard: ((s2 >> 11) & 3) === 0 && (style === 0 || style === 3), mug: ((s2 >> 14) & 1) === 1,
      accent: ACCENTS[(s2 >> 16) % ACCENTS.length], elf: seed % 3 === 0,
    };
  }
  const RECEPTION = {
    seed: 77, key: 'recepcion', shirt: '#0ea5e9', skin: '#e0ac69', hair: '#151515', style: 1, glasses: false, outfit: 'plain',
    beard: false, mug: true, accent: '#fde68a', headset: true, elf: false,
  };

  function head(g, look, ox, oy, expr, hat) {
    stamp(g, HAIR[look.style], { k: OUT, h: look.hair, H: tone(look.hair, look.hair === '#151515' || look.hair === '#2b1d14' ? 0.18 : -0.28), s: look.skin, z: tone(look.skin, -0.14) }, ox, oy);
    const [eyes, mouth] = EXPR[expr] || EXPR.neutral;
    const P = (col, pts) => { for (const [x, y] of pts) R(g, col, ox + x, oy + y); };
    if (look.beard) { P(look.hair, [[2, 10], [3, 10], [4, 10], [7, 10], [8, 10], [9, 10], [3, 11], [4, 11], [5, 11], [6, 11], [7, 11], [8, 11]]); }
    P(OUT, EYES[eyes]);
    if (eyes === 'normal' || eyes === 'right' || eyes === 'left') { /* brillo en los ojos */ }
    if (mouth !== 'tiny' && !look.beard) P('#ff9aa2', [[2, 10], [9, 10]]);
    const MC = '#b4234a';
    if (mouth === 'smile') P(MC, [[5, 10], [6, 10]]);
    else if (mouth === 'flat') P(tone(look.skin, -0.45), [[5, 10], [6, 10]]);
    else if (mouth === 'open') { P(MC, [[5, 10], [6, 10]]); P('#7a1630', [[5, 11], [6, 11]]); }
    else if (mouth === 'grin') { P(MC, [[4, 10], [5, 10], [6, 10], [7, 10]]); P('#ff6b81', [[5, 11], [6, 11]]); }
    else if (mouth === 'o') P('#7a1630', [[5, 10], [6, 10], [5, 11], [6, 11]]);
    else if (mouth === 'tiny') P(MC, [[6, 10]]);
    if (look.glasses && eyes !== 'closed') {
      const G = '#3b2f5c';
      P(G, [[2, 7], [3, 7], [4, 7], [7, 7], [8, 7], [9, 7], [5, 8], [6, 8], [2, 8], [4, 8], [7, 8], [9, 8]]);
      P('#dbeafe', [[4, 9], [9, 9]]);
    }
    if (look.headset) {
      const H = '#1f2937';
      P(H, [[3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [1, 4], [10, 4], [0, 6], [0, 7], [0, 8], [0, 9], [1, 5], [10, 5]]);
      P('#64748b', [[0, 7], [0, 8], [1, 10], [2, 11], [3, 11]]);
      P('#f87171', [[4, 11]]);
    }
    if (hat) stamp(g, HAT, HAT_PAL[hat], ox, oy);
  }

  function torso(g, look, ty) {
    const c = look.shirt, C = tone(c, -0.24), L = tone(c, 0.24), z = tone(look.skin, -0.12), y0 = 16 + ty;
    R(g, OUT, 5, y0, 10, 1);
    R(g, OUT, 4, y0 + 1); R(g, OUT, 15, y0 + 1); R(g, c, 5, y0 + 1, 10, 1);
    R(g, OUT, 3, y0 + 2, 1, 9); R(g, OUT, 16, y0 + 2, 1, 9); R(g, c, 4, y0 + 2, 12, 9);
    R(g, C, 14, y0 + 2, 2, 9); R(g, L, 5, y0 + 2, 1, 3);
    R(g, C, 6, y0 + 5, 1, 6); R(g, C, 13, y0 + 5, 1, 6);
    R(g, z, 9, y0, 2, 3);
    if (look.outfit === 'hoodie') {
      R(g, C, 7, y0 + 1, 6, 2); R(g, z, 9, y0, 2, 2);
      R(g, '#f8fafc', 8, y0 + 3, 1, 3); R(g, '#f8fafc', 11, y0 + 3, 1, 3);
      R(g, C, 7, y0 + 7, 6, 1);
    } else {
      R(g, L, 7, y0 + 1, 2, 1); R(g, L, 11, y0 + 1, 2, 1); R(g, L, 8, y0 + 2); R(g, L, 11, y0 + 2);
      if (look.outfit === 'tie') { R(g, look.accent, 9, y0 + 3, 2, 1); R(g, look.accent, 9, y0 + 4, 2, 4); R(g, tone(look.accent, -0.3), 10, y0 + 4, 1, 4); }
      if (look.outfit === 'stripes') for (const r of [4, 6, 8]) R(g, L, 4, y0 + r, 12, 1);
      if (look.outfit === 'vest') { R(g, tone(look.accent, -0.35), 4, y0 + 3, 4, 8); R(g, tone(look.accent, -0.35), 12, y0 + 3, 4, 8); R(g, '#f8fafc', 8, y0 + 3, 4, 8); R(g, C, 9, y0 + 3, 2, 1); }
    }
  }

  /** Mano: cuadrito de piel con contorno. */
  function hand(g, skin, x, y) { R(g, OUT, x, y, 4, 4); R(g, skin, x + 1, y + 1, 2, 2); R(g, tone(skin, 0.25), x + 1, y + 1); }
  /** Brazo levantado al lado de la cabeza (side -1 izquierda, 1 derecha). */
  function armUp(g, look, side, lift, inward = 0) {
    const c = look.shirt, C = tone(c, -0.24);
    const sx = side < 0 ? 2 : 16;
    R(g, OUT, sx - 1, 8 - lift, 4, 11 + lift);
    R(g, side < 0 ? c : C, sx, 9 - lift, 2, 10 + lift);
    const hx = side < 0 ? sx - 1 + inward : sx - 1 - inward;
    hand(g, look.skin, hx, 5 - lift);
  }

  function buildWorker(look, pose, f, expr, hat, glow) {
    const c = mk(20, 27), g = c.getContext('2d');
    let hy = 4, ty = 0;
    if (pose === 'cheer' && f) { hy = 2; ty = -1; }
    if (pose === 'sleep') { hy = 13 + (f ? 1 : 0); ty = 4; }
    torso(g, look, ty);
    if (pose === 'phone') {
      R(g, OUT, 8, 19, 4, 6); R(g, '#9be7ff', 9, 20, 2, 3); R(g, '#e0f7ff', 9, 20);
      hand(g, look.skin, 5, 21); hand(g, look.skin, 11, 21);
    }
    head(g, look, 4, hy, expr, hat);
    if (glow) { // la pantalla ilumina el lado derecho de la cara
      const d = g.getImageData(10, hy, 6, 13);
      const sk = parseInt(look.skin.slice(1), 16), gc = parseInt(glow.slice(1), 16);
      for (let i = 0; i < d.data.length; i += 4) {
        if (!d.data[i + 3]) continue;
        const r = d.data[i], gg = d.data[i + 1], b = d.data[i + 2];
        const near = Math.abs(r - ((sk >> 16) & 255)) + Math.abs(gg - ((sk >> 8) & 255)) + Math.abs(b - (sk & 255)) < 70;
        if (!near) continue;
        const k = 0.28 * (((i / 4) % 6) / 5 + 0.4);
        d.data[i] = r * (1 - k) + ((gc >> 16) & 255) * k; d.data[i + 1] = gg * (1 - k) + ((gc >> 8) & 255) * k; d.data[i + 2] = b * (1 - k) + (gc & 255) * k;
      }
      g.putImageData(d, 10, hy);
    }
    if (pose === 'wave') armUp(g, look, -1, f ? 1 : 0, f ? 1 : 0);
    else if (pose === 'cheer') { armUp(g, look, -1, f ? 2 : 0); armUp(g, look, 1, f ? 2 : 0); }
    else if (pose === 'stretch') { armUp(g, look, -1, 2, f ? 2 : 1); armUp(g, look, 1, 2, f ? 2 : 1); }
    else if (pose === 'coffee') {
      const my = f ? 18 : 15; // taza a la boca o bajando
      R(g, OUT, 13, my + 3, 4, 19 - my); R(g, tone(look.shirt, -0.24), 14, my + 4, 2, 18 - my);
      hand(g, look.skin, 12, my + 2);
      R(g, OUT, 9, my - 1, 6, 6); R(g, '#f8fafc', 10, my, 4, 4); R(g, '#cbd5e1', 13, my, 1, 4); R(g, '#6b3e26', 10, my, 4, 1);
      R(g, look.accent, 10, my + 2, 4, 1);
      R(g, OUT, 8, my + 1, 1, 3); R(g, '#f8fafc', 8, my + 2);
    }
    return c;
  }
  function workerFrame(look, pose, f, expr, hat, glow) {
    return memo(`w|${look.key}|${look.shirt}${look.skin}${look.hair}|${pose}|${f}|${expr}|${hat || ''}|${glow || ''}`,
      () => buildWorker(look, pose, f, expr, hat, glow));
  }

  /* ------------------------------------------------------------------ */
  /* Escritorio completo (silla, persona, mesa, pantalla, taza, globos)   */
  /* ------------------------------------------------------------------ */

  function idlePose(look, time) {
    const period = 12000 + (look.seed % 7) * 1300;
    const shifted = time + (look.seed % 9973) * 7;
    const ph = shifted % period;
    if (ph < 3400) return ['stretch', 'coffee', 'phone'][(Math.floor(shifted / period) + look.seed) % 3];
    return 'sit';
  }
  function poseOf(t, look, time) {
    if (window.AMB && AMB.isCelebrating(t.id)) return 'cheer';
    if (t.status === 'trabajando') return 'type';
    if (t.status === 'espera') return 'wave';
    if (t.status === 'hoy') return idlePose(look, time);
    if (t.status === 'dormido') return 'sleep';
    return 'away';
  }
  function frameOf(pose, time) {
    if (pose === 'wave') return Math.floor(time / 300) % 2;
    if (pose === 'cheer') return Math.floor(time / 190) % 2;
    if (pose === 'stretch') return Math.floor(time / 700) % 2;
    if (pose === 'coffee') return Math.floor(time / 1100) % 2;
    if (pose === 'sleep') return Math.floor(time / 1300) % 2;
    return 0;
  }
  function exprOf(pose, f, look, time) {
    const blink = ((time + look.seed * 37) % 4100) < 140;
    switch (pose) {
      case 'type': return blink ? 'blinkFocus' : 'focus';
      case 'wave': return blink ? 'blink' : 'call';
      case 'cheer': return 'joy';
      case 'stretch': return 'yawn';
      case 'coffee': return f ? 'neutral' : 'content';
      case 'phone': return 'down';
      case 'sleep': return 'sleep';
      default: {
        if (blink) return 'blink';
        const look8 = Math.floor((time + look.seed * 11) / 2600) % 7;
        return look8 === 2 ? 'lookRight' : look8 === 5 ? 'lookLeft' : 'neutral';
      }
    }
  }

  function chair(bx, by, empty, look) {
    R(ctx, OUT, bx + 1, by, 14, 15);
    R(ctx, '#4b4470', bx + 2, by + 1, 12, 13);
    R(ctx, '#5f5790', bx + 3, by + 2, 10, 3);
    R(ctx, '#3a3458', bx + 2, by + 12, 12, 2);
    if (empty) {
      R(ctx, OUT, bx + 1, by + 12, 14, 5); R(ctx, '#3a3458', bx + 2, by + 13, 12, 3);
      if (look) { // chaqueta colgada en la silla: se fue a casa
        const c = look.shirt, C = tone(c, -0.25);
        R(ctx, OUT, bx + 2, by + 1, 12, 7); R(ctx, c, bx + 3, by + 2, 10, 5); R(ctx, C, bx + 3, by + 6, 10, 1);
        R(ctx, tone(c, 0.25), bx + 6, by + 2, 1, 4); R(ctx, tone(c, 0.25), bx + 9, by + 2, 1, 4); R(ctx, '#f8fafc', bx + 7, by + 2, 2, 2);
        R(ctx, OUT, bx + 2, by + 7, 3, 5); R(ctx, C, bx + 3, by + 7, 1, 4); R(ctx, OUT, bx + 11, by + 7, 3, 5); R(ctx, C, bx + 12, by + 7, 1, 4);
      }
    }
  }

  function deskBody(bx, dy) {
    R(ctx, '#4a2a18', bx, dy, 32, 15);
    R(ctx, '#c08a58', bx + 1, dy + 1, 30, 5);
    R(ctx, '#dba574', bx + 1, dy + 1, 30, 1);
    R(ctx, '#8a5634', bx + 1, dy + 6, 30, 8);
    R(ctx, '#9c6640', bx + 1, dy + 6, 30, 1);
    R(ctx, '#6b3f25', bx + 1, dy + 13, 30, 1);
    R(ctx, '#6b3f25', bx + 16, dy + 7, 1, 6);
    R(ctx, '#e9c46a', bx + 21, dy + 8, 4, 1); R(ctx, '#e9c46a', bx + 8, dy + 8, 4, 1);
  }

  function screen(bx, by, t, time) {
    const st = STATUS[t.status] || STATUS.dormido;
    R(ctx, OUT, bx + 16, by + 3, 15, 12);
    R(ctx, '#3b3557', bx + 17, by + 4, 13, 10);
    const sx = bx + 18, sy = by + 5, sw = 11, sh = 8;
    R(ctx, st.screen, sx, sy, sw, sh);
    if (t.status === 'trabajando') {
      const off = Math.floor(time / 150) % 8;
      for (let k = 0; k < 4; k++) {
        const y = sy + 1 + ((k * 2 + off) % 8);
        if (y < sy + sh - 1) R(ctx, '#064e2a', sx + 1 + (k % 2) * 2, y, 3 + ((k * 5 + off * 3) % 6), 1);
      }
      if (Math.floor(time / 400) % 2) R(ctx, '#f0fdf4', sx + 8, sy + sh - 2, 2, 1);
    } else if (t.status === 'espera') {
      R(ctx, '#7c2d12', sx + 1, sy + 1, 9, 1);
      if (Math.floor(time / 500) % 2) { R(ctx, '#fff7ed', sx + 5, sy + 2, 1, 3); R(ctx, '#fff7ed', sx + 5, sy + 6, 1, 1); }
    } else if (t.status === 'hoy') {
      R(ctx, '#bfdbfe', sx + 1, sy + 1, 2, 2); R(ctx, '#bfdbfe', sx + 1, sy + 4, 2, 2); R(ctx, '#1d4ed8', sx, sy + sh - 1, sw, 1);
      R(ctx, '#eff6ff', sx + 5, sy + 2, 5, 4); R(ctx, '#3b82f6', sx + 5, sy + 2, 5, 1);
    } else if (t.status === 'semana') { // salvapantallas: una estrellita que rebota
      const k = (time / 1800) % 2, px2 = Math.round((k < 1 ? k : 2 - k) * (sw - 3));
      const py = Math.round(Math.abs(Math.sin(time / 700)) * (sh - 3));
      R(ctx, '#fde68a', sx + px2 + 1, sy + py, 1, 3); R(ctx, '#fde68a', sx + px2, sy + py + 1, 3, 1);
    } else {
      R(ctx, '#111827', sx, sy, sw, sh);
    }
    if (t.total && t.done === t.total && t.status !== 'dormido') { // lista terminada: premio en la pantalla
      R(ctx, tone(st.screen, -0.35), sx, sy, sw, sh);
      if (XMAS) gift(sx + 2, sy + 2);
      else trophy(sx + 2, sy);
      if (Math.floor(time / 300) % 2) R(ctx, '#ffffff', sx + 9, sy + 1, 1, 1); else R(ctx, '#ffffff', sx + 1, sy + 6, 1, 1);
    }
    R(ctx, 'rgba(255,255,255,.35)', sx, sy, 3, 1); R(ctx, 'rgba(255,255,255,.25)', sx, sy + 1, 1, 1);
    R(ctx, t.status === 'dormido' ? '#ef4444' : '#4ade80', bx + 28, by + 13);
    R(ctx, OUT, bx + 22, by + 15, 4, 3); R(ctx, '#57507a', bx + 23, by + 15, 2, 2);
    R(ctx, OUT, bx + 20, by + 17, 8, 2); R(ctx, '#57507a', bx + 21, by + 17, 6, 1);
  }

  function steam(x, y, time, seed, n = 3) {
    ctx.save();
    for (let i = 0; i < n; i++) {
      const ph = ((time / 1500) + i / n + (seed % 97) / 97) % 1;
      ctx.globalAlpha = 0.75 * (1 - ph);
      const sx = x + Math.round(Math.sin(ph * 7 + i * 2) * 1.5);
      R(ctx, '#ffffff', sx, Math.round(y - ph * 9), 1, 2);
    }
    ctx.restore();
  }

  function mug(x, y, look, hot, time) {
    R(ctx, OUT, x - 1, y - 1, 6, 6); R(ctx, '#f8fafc', x, y, 4, 4); R(ctx, '#cbd5e1', x + 3, y, 1, 4);
    R(ctx, XMAS ? '#7c2d12' : '#6b3e26', x, y, 4, 1); R(ctx, look.accent, x, y + 2, 4, 1);
    R(ctx, OUT, x + 4, y + 1, 2, 3); R(ctx, '#f8fafc', x + 4, y + 2, 1, 1);
    if (XMAS) R(ctx, '#ffffff', x + 1, y - 1, 2, 1); // malvavisco
    if (hot) steam(x + 2, y - 2, time, look.seed);
  }

  function trophy(x, y) { // 7 x 8
    R(ctx, '#facc15', x + 1, y + 1, 5, 3); R(ctx, '#fef08a', x + 2, y + 1, 1, 2);
    R(ctx, '#facc15', x, y + 1, 1, 2); R(ctx, '#facc15', x + 6, y + 1, 1, 2);
    R(ctx, '#eab308', x + 2, y + 4, 3, 1); R(ctx, '#eab308', x + 3, y + 5, 1, 1);
    R(ctx, '#a16207', x + 2, y + 6, 3, 1); R(ctx, '#854d0e', x + 1, y + 7, 5, 1);
  }
  function gift(x, y) { // 7 x 6
    R(ctx, '#dc2626', x, y + 2, 7, 4); R(ctx, '#ffd166', x + 3, y + 2, 1, 4); R(ctx, '#ffd166', x, y + 3, 7, 1);
    R(ctx, '#ffd166', x + 1, y, 2, 1); R(ctx, '#ffd166', x + 4, y, 2, 1); R(ctx, '#ffd166', x + 2, y + 1, 1, 1); R(ctx, '#ffd166', x + 4, y + 1, 1, 1);
  }

  function bubbleTyping(bx, by, time) {
    const x = bx + 17, y = by - 6;
    R(ctx, OUT, x, y, 14, 8); R(ctx, '#ffffff', x + 1, y + 1, 12, 6); R(ctx, OUT, x, y, 1, 1); R(ctx, OUT, x + 13, y, 1, 1);
    R(ctx, OUT, x + 4, y + 8, 3, 1); R(ctx, '#ffffff', x + 5, y + 7, 1, 1);
    for (let k = 0; k < 3; k++) R(ctx, (Math.floor(time / 250) % 3) === k ? '#16a34a' : '#bbf7d0', x + 2 + k * 4, y + 3, 2, 2);
  }
  function bubbleAlert(x, y) {
    R(ctx, OUT, x, y, 11, 12); R(ctx, '#f97316', x + 1, y + 1, 9, 10); R(ctx, '#fdba74', x + 1, y + 1, 9, 1);
    R(ctx, OUT, x, y, 1, 1); R(ctx, OUT, x + 10, y, 1, 1);
    R(ctx, OUT, x + 3, y + 12, 3, 1); R(ctx, '#f97316', x + 4, y + 11, 2, 1); R(ctx, OUT, x + 4, y + 13, 1, 1);
    R(ctx, '#ffffff', x + 4, y + 2, 3, 5); R(ctx, '#ffffff', x + 4, y + 8, 3, 2);
  }
  function zzz(x, y, time) {
    for (let i = 0; i < 2; i++) {
      const k = ((time / 1100) + i / 2) % 1;
      ctx.save(); ctx.globalAlpha = 1 - k;
      const zx = Math.round(x + k * 6 + i * 2), zy = Math.round(y - k * 11);
      R(ctx, '#e2e8f0', zx, zy, 4, 1); R(ctx, '#e2e8f0', zx + 2, zy + 1); R(ctx, '#e2e8f0', zx + 1, zy + 2); R(ctx, '#e2e8f0', zx, zy + 3, 4, 1);
      ctx.restore();
    }
  }
  function sparkle(x, y, col, s = 1) {
    R(ctx, col, x, y - s, 1, 2 * s + 1); R(ctx, col, x - s, y, 2 * s + 1, 1);
  }

  function drawDesk(o, time) {
    const t = threadById.get(o.thread);
    if (!t) return true;
    const look = lookOf(t.id);
    const bx = o.x * T, by = o.y * T, dy = by + T;
    // Aviso reciente de la rama de recepción (avisos.js), si existe: salta y levanta la mano
    const fx = typeof avisoFx === 'function' ? avisoFx(t.id, time) : null;
    const pose = fx ? (fx.both ? 'cheer' : 'wave') : poseOf(t, look, time);
    const f = frameOf(pose, time);
    const away = pose === 'away';
    chair(bx, by, away, away ? look : null);
    const screenOn = t.status !== 'dormido';
    if (!away) {
      const hat = XMAS ? (look.elf ? 'elf' : 'santa') : null;
      const glow = screenOn && pose === 'type' ? (STATUS[t.status] || STATUS.hoy).screen : null;
      const fr = workerFrame(look, pose, f, exprOf(pose, f, look, time), hat, glow);
      const bob = fx ? -Math.round(fx.hop || 0) : pose === 'type' && Math.floor(time / 600) % 4 === 0 ? 1 : 0;
      ctx.drawImage(fr, bx - 2, by - 9 + bob);
    }
    deskBody(bx, dy);
    // Teclado y ratón
    R(ctx, '#64748b', bx + 3, dy + 1, 12, 4); R(ctx, '#cbd5e1', bx + 4, dy + 1, 10, 3);
    for (let k = 0; k < 4; k++) R(ctx, '#94a3b8', bx + 5 + k * 2, dy + 2, 1, 1);
    R(ctx, '#e2e8f0', bx + 15, dy + 3, 2, 2); R(ctx, '#94a3b8', bx + 15, dy + 4, 2, 1);
    // Manos sobre la mesa
    const skin = look.skin;
    if (pose === 'type') {
      const k = Math.floor(time / 140) % 2;
      hand(ctx, skin, bx + 4, dy - 1 - k); hand(ctx, skin, bx + 10, dy - 2 + k);
    } else if (pose === 'sit' || pose === 'wave') {
      hand(ctx, skin, bx + 10, dy - 1);
      if (pose === 'sit') hand(ctx, skin, bx + 3, dy - 1);
    } else if (pose === 'coffee') hand(ctx, skin, bx + 3, dy - 1);
    else if (pose === 'sleep') { // brazos cruzados bajo la cabeza
      R(ctx, OUT, bx + 1, dy - 2, 15, 5); R(ctx, look.shirt, bx + 2, dy - 1, 13, 3); R(ctx, tone(look.shirt, 0.2), bx + 2, dy - 1, 13, 1);
    }
    screen(bx, by, t, time);
    // Taza (con vapor si alguien la está tomando)
    const hasMug = (look.mug || XMAS) && pose !== 'coffee';
    if (hasMug) mug(bx + 18, dy - 3, look, !away && t.status !== 'dormido', time);
    if (pose === 'coffee') steam(bx + 10, by - 9 + (f ? 18 : 15) - 2, time, look.seed);
    // Premio por terminar la lista
    const complete = t.total && t.done === t.total;
    // Avance en el frente del escritorio
    if (t.total) {
      R(ctx, '#2a1a10', bx + 4, dy + 9, 24, 4);
      const w = Math.max(1, Math.round((22 * t.done) / t.total));
      R(ctx, complete ? '#4ade80' : '#facc15', bx + 5, dy + 10, w, 2);
      R(ctx, complete ? '#bbf7d0' : '#fef08a', bx + 5, dy + 10, w, 1);
    }
    // Globos
    if (pose === 'cheer') {
      const k = Math.floor(time / 160);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + time / 500;
        sparkle(Math.round(bx + 8 + Math.cos(a) * 11), Math.round(by - 1 + Math.sin(a) * 7), ['#ffd166', '#fff', '#f472b6', '#60a5fa'][(i + k) % 4]);
      }
    } else if (t.status === 'trabajando') bubbleTyping(bx, by, time);
    else if (t.status === 'espera') bubbleAlert(bx + 19, by - 12 - Math.round(Math.abs(Math.sin(time / 260)) * 3));
    else if (pose === 'sleep') zzz(bx + 12, by + 4, time);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Recepcionista                                                        */
  /* ------------------------------------------------------------------ */

  function drawReceptionist(o, time) {
    const bx = (o.x + 1) * T + 8, by = o.y * T;
    const waiting = allThreads().filter(t => t.status === 'espera').length;
    const pose = waiting ? 'wave' : (time % 15000) < 3200 ? 'coffee' : 'sit';
    const f = frameOf(pose, time);
    R(ctx, OUT, bx + 1, by + 1, 14, 14); R(ctx, '#4b4470', bx + 2, by + 2, 12, 12);
    const fr = workerFrame(RECEPTION, pose, f, exprOf(pose, f, RECEPTION, time), XMAS ? 'santa' : null, null);
    ctx.drawImage(fr, bx - 2, by - 9);
    if (pose === 'coffee') steam(bx + 10, by - 9 + (f ? 18 : 15) - 2, time, 5);
    // Lamparita y timbre sobre el mostrador
    const lx = o.x * T + 4, ly = (o.y + 1) * T - 2;
    R(ctx, OUT, lx + 2, ly - 7, 1, 8); R(ctx, OUT, lx - 1, ly - 10, 7, 4); R(ctx, '#fbbf24', lx, ly - 9, 5, 2); R(ctx, '#fde68a', lx + 1, ly - 7, 3, 1);
    R(ctx, OUT, lx, ly + 1, 6, 2);
    const bellX = (o.x + o.w) * T - 10;
    R(ctx, OUT, bellX, ly - 2, 6, 4); R(ctx, '#fbbf24', bellX + 1, ly - 1, 4, 2); R(ctx, '#fde68a', bellX + 2, ly - 1); R(ctx, OUT, bellX + 2, ly - 3, 2, 1);
    if (waiting) bubbleAlert(bx + 3, by - 18 - Math.round(Math.abs(Math.sin(time / 260)) * 3));
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Plantas que se mecen                                                 */
  /* ------------------------------------------------------------------ */

  function plantPot(g, bx, by) {
    R(g, OUT, bx + 3, by + 9, 10, 7);
    R(g, '#c2552d', bx + 4, by + 10, 8, 5); R(g, '#e07a4f', bx + 4, by + 10, 8, 2); R(g, '#9a3412', bx + 9, by + 12, 3, 3);
    R(g, '#4a2a18', bx + 5, by + 10, 6, 1);
  }
  function plantLeaves(c, bx, by, time, seed) {
    const s = Math.sin(time / 1250 + seed);
    const o1 = Math.round(s * 0.6), o2 = Math.round(s * 1.4);
    const D = '#2f7a3f', M = '#4caf63', L = '#86d993';
    const leaf = (x, y, w, h, o) => {
      R(c, OUT, bx + x - 1 + o, by + y - 1, w + 2, h + 2);
      R(c, M, bx + x + o, by + y, w, h); R(c, D, bx + x + o, by + y + h - 1, w, 1); R(c, L, bx + x + o, by + y, Math.max(1, w - 2), 1);
    };
    R(c, '#2f6b35', bx + 7, by + 5, 2, 5);
    leaf(1, 5, 5, 4, o1); leaf(10, 4, 5, 4, o1); leaf(4, 1, 4, 5, o2); leaf(8, 0, 4, 5, o2);
    R(c, L, bx + 9 + o2, by + 1, 1, 3);
  }

  /* ------------------------------------------------------------------ */
  /* Retrato grande para la ficha                                         */
  /* ------------------------------------------------------------------ */

  function portraitPose(t) {
    if (t.total && t.done === t.total) return ['cheer', 'joy'];
    if (t.status === 'trabajando') return ['type', 'focus'];
    if (t.status === 'espera') return ['wave', 'call'];
    if (t.status === 'semana') return ['sit', 'content'];
    if (t.status === 'dormido') return ['sit', 'sleep'];
    return ['sit', 'neutral'];
  }
  function drawPortrait(c, t, blink) {
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const look = lookOf(t.id);
    const st = STATUS[t.status] || STATUS.dormido;
    const [pose, expr0] = portraitPose(t);
    const expr = blink ? (expr0 === 'focus' ? 'blinkFocus' : 'blink') : expr0;
    // Fondo: rayos de color según el estado
    const base = tone(st.color, -0.55), ray = tone(st.color, -0.38);
    R(g, base, 0, 0, 40, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      const a = Math.atan2(y - 22, x - 20);
      if (Math.floor((a + Math.PI) / (Math.PI / 6)) % 2 === 0) R(g, ray, x, y);
    }
    R(g, tone(st.color, -0.2), 0, 34, 40, 6);
    const hat = XMAS ? (look.elf ? 'elf' : 'santa') : null;
    const fr = buildWorker(look, pose === 'cheer' ? 'cheer' : pose, 0, expr, hat, null);
    g.drawImage(fr, 0, 3, 20, 20, 0, 0, 40, 40);
    // Detalles a media escala: brillo en los ojos y en el pelo
    const eyesOpen = !['blink', 'blinkFocus', 'sleep', 'joy', 'content', 'yawn'].includes(expr);
    const ex = expr === 'focus' ? 1 : 0;
    if (eyesOpen) { R(g, '#ffffff', (4 + 3 + ex) * 2, (4 + 8 - 3) * 2); R(g, '#ffffff', (4 + 8 + ex) * 2, (4 + 8 - 3) * 2); }
    if (!hat) { R(g, tone(look.hair, 0.45), 14, 9, 4, 1); R(g, tone(look.hair, 0.45), 12, 10, 2, 1); }
    if (t.status === 'dormido') { R(g, '#e2e8f0', 30, 6, 4, 1); R(g, '#e2e8f0', 32, 7); R(g, '#e2e8f0', 31, 8); R(g, '#e2e8f0', 30, 9, 4, 1); }
  }
  function portrait(t) {
    const c = mk(40, 40);
    c.className = 'portrait';
    c.dataset.status = t.status;
    drawPortrait(c, t, false);
    const iv = setInterval(() => {
      if (!c.isConnected) { clearInterval(iv); return; }
      drawPortrait(c, t, true);
      setTimeout(() => { if (c.isConnected) drawPortrait(c, t, false); }, 150);
    }, 3300 + (hsh(t.id) % 900));
    return c;
  }

  return { drawDesk, drawReceptionist, drawPlayer, portrait, plantPot, plantLeaves, lookOf, shadow, tone, mix, stamp, mk, R, OUT, playerFrame, workerFrame, sparkle };
})();
