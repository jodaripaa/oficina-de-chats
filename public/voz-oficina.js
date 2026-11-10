'use strict';
/* Voz en la oficina: reporte hablado, reunión de la mañana, dictado por voz y botón de silencio.
   Usa window.Voz (voz.js u otro motor con la misma forma) siempre en el momento de llamar.
   Se carga después de game.js y se conecta al juego así:
   - escucha el evento 'oficina:ventana' que game.js lanza al abrir el escritorio, la recepción y el buzón,
     y les agrega sus botones;
   - lee las variables del juego (map, cam, player, SCALE, canvas, threadById, modalOpen…) para dibujar
     los globos en una capa propia encima del canvas y para llevar la cámara a quien habla. */

(() => {
  const V = () => window.Voz || null;
  const ahora = () => performance.now();
  const ACTIVOS = ['trabajando', 'espera', 'hoy'];

  /* ------------------------------------------------------------------ */
  /* Qué dice cada uno                                                    */
  /* ------------------------------------------------------------------ */

  const plano = s => String(s || '').replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\s+/g, ' ').trim();
  const conPunto = s => (/[.!?…]$/.test(s) ? s : `${s}.`);
  function primeraFrase(s, max) {
    const t = plano(s);
    const m = t.match(/^.+?[.!?…](?=\s|$)/);
    let f = m ? m[0] : t;
    if (f.length > max) {
      f = f.slice(0, max);
      const pausa = Math.max(f.lastIndexOf(', '), f.lastIndexOf('; '), f.lastIndexOf(': '));
      const k = pausa > max * 0.5 ? pausa : f.lastIndexOf(' '); // mejor cortar en una coma que a media idea
      f = (k > max * 0.5 ? f.slice(0, k) : f).replace(/[\s,;:.-]+$/, '') + '…';
    }
    return f;
  }

  /** Reporte corto de un hilo: avance, resumen y pregunta pendiente (máximo 3 frases). */
  function reporte(t) {
    const partes = [];
    if (t.total > 0) {
      if (t.done >= t.total) partes.push(t.total === 1 ? '¡Terminé el único paso de mi lista!' : `¡Terminé mi lista: los ${t.total} pasos!`);
      else if (t.done === 0) partes.push(`Llevo 0 de ${t.total} pasos: apenas estoy arrancando.`);
      else partes.push(`Llevo ${t.done} de ${t.total} pasos.`);
    }
    const ahoraEn = t.current ? conPunto(`Ahora estoy en: ${primeraFrase(t.current, 110)}`) : '';
    if (ahoraEn && (t.status === 'trabajando' || !t.recap)) partes.push(ahoraEn); // mientras trabaja, el paso actual es lo más fresco
    else if (t.recap) partes.push(conPunto(primeraFrase(t.recap, 150)));
    if (t.ask) {
      const a = primeraFrase(t.ask, 150);
      partes.push(/\?$/.test(a) ? `Te pregunto: ${a}` : `Te dejé una pregunta: ${conPunto(a)}`);
    }
    if (!partes.length) {
      partes.push(t.status === 'trabajando'
        ? 'Estoy en plena faena, pero todavía no armé lista de pasos ni resumen. ¡Pronto te cuento!'
        : t.status === 'semana' || t.status === 'dormido'
          ? 'Hace rato no trabajo en esto y no dejé lista ni resumen, así que no te invento nada. Si quieres, despiértame con una instrucción.'
          : 'No tengo lista de pasos ni resumen todavía, así que no te invento nada. Pregúntame «¿cómo vas?» y te cuento.');
    } else if (partes.length === 1 && t.total > 0 && t.done < t.total && t.status === 'trabajando') {
      partes.push('¡Sigo dándole!');
    }
    return partes.join(' ');
  }

  function apertura(n) {
    if (!n) return XMAS ? '¡Jo jo jo! Hoy no hay nadie activo en la oficina. ¡Día tranquilo en el taller!' : '¡Buenos días! Hoy no hay hilos activos en la oficina. ¡Día tranquilo!';
    return XMAS
      ? `¡Jo jo jo! Buenos días, equipo. Hoy repasamos ${n === 1 ? '1 hilo' : `${n} hilos`}.`
      : `¡Buenos días! Arranquemos la reunión: ${n === 1 ? 'hay 1 hilo activo' : `hay ${n} hilos activos`}.`;
  }
  function cierre() {
    const todos = allThreads();
    const n = s => todos.filter(t => t.status === s).length;
    const w = n('trabajando'), e = n('espera'), h = n('hoy');
    const trozos = [];
    if (w) trozos.push(`${w} trabajando`);
    if (e) trozos.push(e === 1 ? '1 te espera' : `${e} te esperan`);
    if (h) trozos.push(h === 1 ? '1 activo hoy' : `${h} activos hoy`);
    if (!trozos.length) return '¡Eso fue todo! Ya nadie quedó activo. ¡Buen día!';
    const lista = trozos.length > 1 ? `${trozos.slice(0, -1).join(', ')} y ${trozos[trozos.length - 1]}` : trozos[0];
    const remate = e ? '¡No dejes esperando a nadie!' : XMAS ? '¡Felices fiestas y buen trabajo!' : '¡Buen día de trabajo!';
    return `Eso fue todo: ${lista}. ${remate}`;
  }

  /* ------------------------------------------------------------------ */
  /* Dónde está quien habla                                               */
  /* ------------------------------------------------------------------ */

  const escritorioDe = id => (map ? map.objects.find(o => o.kind === 'desk' && o.thread === id) : null) || null;
  function archivadorDe(id) {
    if (!map || !world) return null;
    const p = world.projects.find(x => x.threads.some(t => t.id === id));
    const r = p && map.rooms.find(x => x.key === p.key);
    return r ? map.objects.find(o => o.kind === 'cabinet' && o.room === r.i) || null : null;
  }
  const recepcion = () => (map ? map.objects.find(o => o.kind === 'reception') : null) || null;

  /** Punta del globo (arriba y abajo) y boca de quien habla, en píxeles del mundo. */
  function ancla(q, time) {
    if (!map) return null;
    if (q.tipo === 'hilo') {
      const o = escritorioDe(q.id);
      if (o) {
        const t = threadById.get(q.id);
        const presente = t && ACTIVOS.includes(t.status);
        const bob = !t ? 0 : t.status === 'trabajando' ? Math.floor(time / 180) % 2 : t.status === 'espera' ? Math.round(Math.sin(time / 300)) : 0;
        return { x: o.x * T + 8, arriba: o.y * T - 8, abajo: (o.y + 2) * T + 2, boca: presente ? { x: o.x * T + 7, y: o.y * T + 7 + bob } : null };
      }
      const c = archivadorDe(q.id); // el hilo no tiene escritorio: habla desde el archivador
      if (c) return { x: (c.x + 0.5) * T, arriba: c.y * T - 2, abajo: (c.y + 1) * T + 2, boca: null };
    }
    if (q.tipo === 'recepcion') {
      const o = recepcion();
      if (o) {
        const bx = (o.x + 1) * T + 8, by = o.y * T; // igual que drawReceptionist
        return { x: bx + 8, arriba: by - 8, abajo: (o.y + 2) * T + 2, boca: { x: bx + 7, y: by + 7 } };
      }
    }
    const x = (player.fx + (player.tx - player.fx) * player.t) * T;
    const y = (player.fy + (player.ty - player.fy) * player.t) * T;
    return { x: x + 8, arriba: y - 9, abajo: y + T + 2, boca: null };
  }

  /** Pone al jugador frente a quien va a hablar; la cámara lo sigue sola y suave. */
  function irA(q) {
    if (!map) return false;
    const o = q.tipo === 'hilo' ? escritorioDe(q.id) || archivadorDe(q.id) : q.tipo === 'recepcion' ? recepcion() : null;
    if (!o) return false;
    const spots = standSpots(o);
    if (player.t >= 1 && spots.some(s => s.x === player.tx && s.y === player.ty)) return false;
    const cx = q.tipo === 'recepcion' ? o.x + 1.5 : o.x;
    const s = spots.sort((a, b) => b.y - a.y || Math.abs(a.x - cx) - Math.abs(b.x - cx))[0];
    if (!s || !walkable(s.x, s.y)) return false;
    player.tx = player.fx = s.x; player.ty = player.fy = s.y; player.t = 1;
    player.path = []; player.onArrive = null; player.dir = 'up';
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Reporte y reunión                                                    */
  /* ------------------------------------------------------------------ */

  let sesion = null;  // { modo: 'reporte' | 'reunion', pasos, i, ticket, pausada, esperas }
  let globo = null;   // { quien, titulo, frases, i, hablando, nacio, hasta, cache }

  function dormir(s, ms) {
    return new Promise(resolver => {
      const fin = () => { clearTimeout(t); s.esperas.delete(fin); resolver(); };
      const t = setTimeout(fin, ms);
      s.esperas.add(fin);
    });
  }
  const despertar = s => [...s.esperas].forEach(f => f());

  function nueva(modo, pasos) {
    if (sesion) terminar(sesion);
    const s = { modo, pasos, i: 0, ticket: 0, pausada: false, esperas: new Set() };
    sesion = s;
    globo = null;
    pintarBarra();
    correr(s);
    return s;
  }

  async function correr(s) {
    while (sesion === s && s.i < s.pasos.length) {
      if (s.pausada) { await dormir(s, 2e9); continue; }
      const yo = ++s.ticket;
      const paso = s.pasos[s.i];
      pintarBarra();
      if (irA(paso.quien)) {
        await dormir(s, 480); // deja que la cámara llegue
        if (sesion !== s || s.ticket !== yo) continue;
      }
      const texto = typeof paso.texto === 'function' ? paso.texto() : paso.texto;
      globo = { quien: paso.quien, titulo: paso.titulo, frases: [texto], i: 0, hablando: true, nacio: ahora(), hasta: 0, cache: null };
      const g0 = globo;
      const onFrase = (i, frase, frases) => { if (s.ticket === yo && globo === g0) { g0.frases = frases; g0.i = i; } };
      const voz = V();
      if (voz) await voz.hablar(texto, { id: paso.voz, onFrase });
      else await dormir(s, Math.max(1800, 700 + texto.length * 55));
      if (sesion !== s) break;
      if (s.ticket !== yo) continue; // se pausó o se saltó
      g0.hablando = false;
      await dormir(s, 700);
      if (sesion !== s) break;
      if (s.ticket !== yo) continue;
      s.i++;
    }
    if (sesion === s) terminar(s);
  }

  function pausar(s, aviso) {
    if (s.pausada) return;
    s.pausada = true;
    s.ticket++;
    V()?.callar();
    despertar(s);
    if (globo) globo.hablando = false;
    pintarBarra();
    if (aviso) toast(aviso, 'info', 4500);
  }
  function seguir(s) { s.pausada = false; despertar(s); pintarBarra(); }
  function saltar(s) { s.ticket++; s.i++; s.pausada = false; V()?.callar(); despertar(s); }
  function terminar(s) {
    if (!s || sesion !== s) return;
    sesion = null;
    s.ticket++;
    despertar(s);
    V()?.callar();
    if (globo) { globo.hablando = false; globo.hasta = ahora() + 450; }
    pintarBarra();
  }

  function escucharReporte(id) {
    const t = threadById.get(id);
    if (!t) return;
    closeModal();
    nueva('reporte', [{ quien: { tipo: 'hilo', id }, voz: id, titulo: t.title, hilo: id, texto: () => reporte(threadById.get(id) || t) }]);
  }

  function reunion() {
    if (!world || !map) return;
    const orden = { espera: 0, trabajando: 1, hoy: 2 }; // primero los que te esperan
    const hilos = allThreads().filter(t => t.status in orden).sort((a, b) => orden[a.status] - orden[b.status]);
    closeModal();
    const abre = XMAS
      ? { quien: { tipo: 'jugador' }, voz: 'santa', titulo: '🎅 Santa' }
      : { quien: { tipo: 'recepcion' }, voz: 'recepcion', titulo: '🛎️ Recepción' };
    const pasos = [{ ...abre, texto: apertura(hilos.length) }];
    for (const t of hilos) {
      pasos.push({ quien: { tipo: 'hilo', id: t.id }, voz: t.id, titulo: t.title, hilo: t.id, texto: () => reporte(threadById.get(t.id) || t) });
    }
    if (hilos.length) pasos.push({ quien: { tipo: 'recepcion' }, voz: 'recepcion', titulo: '🛎️ Recepción', texto: cierre });
    nueva('reunion', pasos);
  }

  /* ---- Barra de control ---- */
  const barra = document.createElement('div');
  barra.className = 'voz-barra';
  barra.hidden = true;
  barra.setAttribute('role', 'region');
  barra.setAttribute('aria-label', 'Controles de voz');
  barra.innerHTML = `
    <span class="voz-que" aria-live="polite"></span>
    <button class="pixel-btn" data-voz="pausa">⏸ PAUSAR</button>
    <button class="pixel-btn" data-voz="saltar">⏭ SALTAR</button>
    <button class="pixel-btn" data-voz="ficha">🗂 VER FICHA</button>
    <button class="pixel-btn ghost" data-voz="fin">⏹ TERMINAR</button>`;
  document.body.append(barra);
  const boton = k => barra.querySelector(`[data-voz="${k}"]`);

  function pintarBarra() {
    const s = sesion;
    barra.hidden = !s;
    document.body.classList.toggle('voz-sesion', !!s);
    if (!s) return;
    const paso = s.pasos[Math.min(s.i, s.pasos.length - 1)];
    const enReunion = s.modo === 'reunion';
    const total = s.pasos.filter(p => p.hilo).length;
    const k = s.pasos.slice(0, s.i + 1).filter(p => p.hilo).length;
    const que = barra.querySelector('.voz-que');
    que.innerHTML = enReunion
      ? `☕ Reunión · ${paso.hilo ? `${k}/${total} · <b>${esc(cut(paso.titulo, 42))}</b>` : s.i === 0 ? '<b>saludo</b>' : '<b>cierre</b>'}${s.pausada ? ' · ⏸ en pausa' : ''}`
      : `🔊 Reporte · <b>${esc(cut(paso.titulo, 46))}</b>`;
    que.title = paso.titulo;
    boton('pausa').hidden = !enReunion;
    boton('pausa').textContent = s.pausada ? '▶ SEGUIR' : '⏸ PAUSAR';
    boton('saltar').hidden = !enReunion;
    boton('ficha').hidden = !paso.hilo;
    boton('fin').textContent = enReunion ? '⏹ TERMINAR' : '⏹ CALLAR';
  }
  barra.addEventListener('click', ev => {
    const b = ev.target.closest('[data-voz]');
    const s = sesion;
    if (!b || !s) return;
    b.blur();
    const accion = b.dataset.voz;
    if (accion === 'pausa') { if (s.pausada) seguir(s); else pausar(s); }
    else if (accion === 'saltar') saltar(s);
    else if (accion === 'fin') terminar(s);
    else if (accion === 'ficha') { const paso = s.pasos[s.i]; if (paso?.hilo) openDesk(paso.hilo); }
  });
  // Esc termina (en captura: así cerrar una ventana con Esc no termina la reunión)
  addEventListener('keydown', ev => { if (ev.key === 'Escape' && sesion && !modalOpen) terminar(sesion); }, true);

  /* ------------------------------------------------------------------ */
  /* Globo de texto (capa propia encima del canvas)                       */
  /* ------------------------------------------------------------------ */

  const capa = document.createElement('canvas');
  capa.id = 'voz-capa';
  capa.setAttribute('aria-hidden', 'true');
  canvas.after(capa);
  const g = capa.getContext('2d');
  let sucio = false;

  function envolver(texto, ancho) {
    const out = [];
    let linea = '';
    for (const p of String(texto).split(/\s+/).filter(Boolean)) {
      const prueba = linea ? `${linea} ${p}` : p;
      if (!linea || g.measureText(prueba).width <= ancho) linea = prueba;
      else { out.push(linea); linea = p; }
    }
    if (linea) out.push(linea);
    if (out.length > 6) { out.length = 6; out[5] = `${out[5].replace(/\s*\S*$/, '')}…`; }
    return out;
  }

  function dibujarGlobo(gl, time) {
    const a = ancla(gl.quien, time);
    if (!a) return;
    const S = SCALE;
    const pausado = !!sesion?.pausada;

    // Boca que se mueve mientras habla
    if (a.boca && gl.hablando && !pausado && Math.floor(time / 120) % 3 !== 0) {
      g.setTransform(S, 0, 0, S, -Math.round(cam.x * S), -Math.round(cam.y * S));
      g.fillStyle = '#7f1d1d';
      g.fillRect(a.boca.x, a.boca.y, 2, 1);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }

    const b = Math.max(2, Math.round(S * 0.9));   // grosor del borde
    const fs = Math.max(16, Math.round(6.2 * S)); // letra del texto
    const ft = Math.max(9, Math.round(3.4 * S));  // letra del nombre
    const pad = Math.round(fs * 0.6);
    const texto = gl.frases[Math.min(gl.i, gl.frases.length - 1)] || '';
    const clave = `${texto}|${fs}|${capa.width}|${gl.titulo}`;
    if (!gl.cache || gl.cache.clave !== clave) {
      g.font = `${fs}px "VT323", monospace`;
      const lineas = envolver(texto, Math.min(capa.width - 40, fs * 24) - 2 * pad);
      let w = Math.max(...lineas.map(l => g.measureText(l).width), 0);
      const nombre = cut(gl.titulo, 30).toUpperCase();
      g.font = `${ft}px "Press Start 2P", monospace`;
      w = Math.max(w, g.measureText(`🔊 ${nombre}`).width); // con espacio para el ícono
      gl.cache = { clave, lineas, nombre, w: Math.ceil(w + 2 * pad) };
    }
    const { lineas, nombre, w } = gl.cache;
    const altoLinea = Math.round(fs * 1.02);
    const puntos = gl.frases.length > 1;
    const h = pad + ft + Math.round(ft * 0.9) + lineas.length * altoLinea + (puntos ? Math.round(fs * 0.5) : 0) + Math.round(pad * 0.5);
    const cola = 4 * b;
    const [sx, syArriba] = screenXY(a.x, a.arriba);
    const [, syAbajo] = screenXY(a.x, a.abajo);
    const dpr = canvas.width / innerWidth;
    const techo = (hudEl.getBoundingClientRect().bottom + 8) * dpr;
    const abajo = syArriba - cola - h < techo; // sin espacio arriba (la barra lo taparía): va debajo
    const by = Math.round(abajo ? syAbajo + cola : syArriba - cola - h);
    const bx = Math.round(Math.max(12, Math.min(capa.width - w - 12, sx - w / 2)));

    const nace = Math.min(1, (time - gl.nacio) / 160);
    const muere = gl.hasta ? Math.max(0, (gl.hasta - time) / 450) : 1;
    g.globalAlpha = nace * muere;

    const fondo = '#fffdf5';
    const borde = XMAS ? '#9b1c1c' : '#2b2350';
    const tinta = '#1e1b4b';
    const acento = XMAS ? '#15803d' : '#c2264a';

    // Sombra, cuerpo con esquinas recortadas (estilo pixel) y cola
    g.fillStyle = 'rgba(12,10,24,.35)';
    g.fillRect(bx + b, by + 2 * b, w - b, h);
    g.fillStyle = borde;
    g.fillRect(bx + b, by, w - 2 * b, h);
    g.fillRect(bx, by + b, w, h - 2 * b);
    g.fillStyle = fondo;
    g.fillRect(bx + 2 * b, by + b, w - 4 * b, h - 2 * b);
    g.fillRect(bx + b, by + 2 * b, w - 2 * b, h - 4 * b);
    const cx = Math.round(Math.max(bx + 5 * b, Math.min(bx + w - 5 * b, sx)));
    for (let k = 0; k < 3; k++) {
      const ancho = (3 - k) * 2 * b;
      const y = abajo ? by - (k + 1) * b : by + h + k * b;
      g.fillStyle = borde; g.fillRect(cx - ancho / 2 - b, y, ancho + 2 * b, b);
      g.fillStyle = fondo; g.fillRect(cx - ancho / 2, y, ancho, b);
    }
    g.fillStyle = fondo; g.fillRect(cx - 3 * b, abajo ? by : by + h - b, 6 * b, b);
    g.fillStyle = borde; g.fillRect(cx - b, abajo ? by - 4 * b : by + h + 3 * b, 2 * b, b);

    // Nombre y subtítulo
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.font = `${ft}px "Press Start 2P", monospace`;
    g.fillStyle = acento;
    const icono = pausado ? '⏸ ' : gl.hablando ? (V()?.silenciado ? '💬 ' : '🔊 ') : '';
    g.fillText(`${icono}${nombre}`, bx + pad, by + pad);
    g.font = `${fs}px "VT323", monospace`;
    g.fillStyle = tinta;
    let y = by + pad + ft + Math.round(ft * 0.9);
    for (const l of lineas) { g.fillText(l, bx + pad, y); y += altoLinea; }
    if (puntos) { // una cajita por frase: las dichas, rellenas
      const r = Math.max(3, Math.round(b * 1.3));
      gl.frases.forEach((_, k) => {
        g.fillStyle = k <= gl.i ? acento : '#d6d3e6';
        g.fillRect(bx + w - pad - (gl.frases.length - k) * 2 * r + r, y + Math.round(fs * 0.12), r, r);
      });
    }
    g.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ */
  /* Dictado (🎙️)                                                         */
  /* ------------------------------------------------------------------ */

  let dictado = null; // { el, parar(ignorar) } del cuadro que está escuchando

  function ponerMicrofono(box, textarea) {
    if (!textarea || textarea.dataset.voz) return;
    textarea.dataset.voz = '1';
    const caja = document.createElement('div');
    caja.className = 'voz-say';
    textarea.parentNode.insertBefore(caja, textarea);
    caja.append(textarea);
    const mic = document.createElement('button');
    mic.type = 'button';
    mic.className = 'pixel-btn voz-mic';
    caja.append(mic);
    const estado = document.createElement('div');
    estado.className = 'voz-estado';
    estado.setAttribute('aria-live', 'polite');
    caja.after(estado);

    const pintar = on => {
      const puede = !!V()?.puedeEscuchar;
      mic.textContent = on ? '⏹' : '🎙️';
      mic.classList.toggle('on', on);
      mic.classList.toggle('sin', !puede);
      mic.title = on ? 'Parar el dictado' : puede ? 'Dictar con tu voz (el texto no se envía solo)' : 'Este navegador no sabe dictar';
      mic.setAttribute('aria-label', mic.title);
      mic.setAttribute('aria-pressed', String(on));
    };
    const avisar = (txt, tono = '') => { estado.textContent = txt; estado.className = `voz-estado ${tono}`; };
    pintar(false);

    let control = null;
    const parar = ignorar => {
      if (!control) return;
      if (ignorar) control.ignorar = true; // lo que llegue después no pisa tu texto
      control.detener?.();
    };

    mic.addEventListener('click', () => {
      if (control) { parar(false); return; }
      const voz = V();
      if (!voz?.puedeEscuchar) {
        const m = 'Este navegador no sabe dictar. Abre la oficina en Microsoft Edge o Chrome para hablarle.';
        avisar(`⚠️ ${m}`, 'error');
        toast(m, 'error', 6000);
        return;
      }
      const base = textarea.value.trim() ? textarea.value.replace(/\s*$/, ' ') : '';
      const c = { ignorar: false, error: false, detener: null };
      control = c;
      dictado = { el: textarea, parar };
      pintar(true);
      avisar('🎙️ Te escucho… habla con calma. Clic en ⏹ para parar. Nada se envía solo.', 'on');
      c.detener = voz.escuchar({
        onParcial: txt => {
          if (c.ignorar) return;
          textarea.value = base + txt;
          textarea.scrollTop = textarea.scrollHeight;
        },
        onError: msg => {
          if (c.ignorar) return;
          c.error = true;
          avisar(`⚠️ ${msg}`, 'error');
          toast(msg, 'error', 6000);
        },
        onFinal: txt => {
          if (control === c) control = null;
          if (dictado?.el === textarea) dictado = null;
          pintar(false);
          if (c.ignorar) { avisar(''); return; }
          if (!c.error) avisar(txt ? '✅ Listo. Revisa el texto y pulsa Enviar cuando quieras.' : '🤔 No alcancé a oír nada. Prueba otra vez.', txt ? 'ok' : '');
          if (textarea.isConnected) textarea.focus();
        },
      });
    });
    // Si escribes o envías, el dictado se detiene para no pisar tu texto
    textarea.addEventListener('input', () => { if (control) parar(true); }); // poner .value desde el código no dispara 'input'
    textarea.addEventListener('keydown', ev => { if (control && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) parar(true); }, true);
    box.addEventListener('click', ev => { if (control && ev.target.closest('[data-send],[data-go],[data-quick]')) parar(true); }, true);
  }

  /* ------------------------------------------------------------------ */
  /* Botones en las ventanas y en la barra de arriba                      */
  /* ------------------------------------------------------------------ */

  function ponerReporte(box, t) {
    const cabeza = box.querySelector('.modal-head');
    if (!cabeza || cabeza.querySelector('[data-reporte]')) return;
    const cont = document.createElement('div');
    cont.className = 'voz-head';
    cont.innerHTML = '<button class="pixel-btn" data-reporte title="El trabajador te cuenta en voz cómo va"><span aria-hidden="true">🔊</span><span class="voz-txt"> ESCUCHAR REPORTE</span></button>';
    cabeza.insertBefore(cont, cabeza.querySelector('.close'));
    cont.firstElementChild.addEventListener('click', () => escucharReporte(t.id));
  }

  function ponerReunion(box) {
    if (box.querySelector('[data-reunion]')) return;
    const activos = allThreads().filter(t => ACTIVOS.includes(t.status)).length;
    let fila = box.querySelector('.modal-foot .foot-row');
    if (!fila) {
      const pie = document.createElement('footer');
      pie.className = 'modal-foot';
      pie.innerHTML = '<div class="foot-row"></div>';
      box.append(pie);
      fila = pie.firstElementChild;
    }
    const b = document.createElement('button');
    b.className = 'pixel-btn primary';
    b.dataset.reunion = '1';
    b.textContent = '☕ REUNIÓN DE LA MAÑANA';
    const nota = document.createElement('span');
    nota.className = 'note';
    nota.textContent = activos
      ? `Te llevo escritorio por escritorio: ${activos === 1 ? 'el hilo activo te cuenta' : `los ${activos} hilos activos te cuentan`} cómo van.`
      : 'Hoy no hay hilos activos, pero igual te saludo.';
    b.addEventListener('click', reunion);
    fila.prepend(b, nota);
  }

  document.addEventListener('oficina:ventana', ev => {
    const { tipo, box, hilo } = ev.detail || {};
    if (!box) return;
    if (tipo === 'escritorio' && hilo) { ponerReporte(box, hilo); ponerMicrofono(box, box.querySelector('textarea.say')); }
    else if (tipo === 'buzon') ponerMicrofono(box, box.querySelector('textarea.say'));
    else if (tipo === 'recepcion') ponerReunion(box);
  });

  // Botón para silenciar las voces (se recuerda en este navegador)
  const btnVoz = document.createElement('button');
  btnVoz.className = 'pixel-btn';
  btnVoz.id = 'btn-voz';
  const ayuda = document.querySelector('#btn-help');
  const acciones = ayuda?.parentNode || document.querySelector('.hud-actions');
  acciones?.insertBefore(btnVoz, ayuda || null);
  function pintarVoz() {
    const v = V();
    const sin = !v?.puedeHablar;
    btnVoz.textContent = sin || v.silenciado ? '🤐' : '🗣️'; // distinto del 🔊 de la campanita
    btnVoz.title = sin ? 'Este navegador no tiene voces: verás solo los globos' : v.silenciado ? 'Voces en silencio: clic para prenderlas' : 'Voces prendidas: clic para silenciarlas';
    btnVoz.setAttribute('aria-label', btnVoz.title);
    btnVoz.setAttribute('aria-pressed', String(!!(sin || v.silenciado)));
  }
  btnVoz.addEventListener('click', () => {
    btnVoz.blur();
    const v = V();
    if (!v?.puedeHablar) { toast('Este navegador no sabe hablar: los trabajadores te muestran sus globos igual. En Microsoft Edge tienen voz.', 'info', 5000); return; }
    const callado = v.silenciar(!v.silenciado);
    pintarVoz();
    toast(callado ? '🤐 Voces en silencio. Los globos siguen mostrando lo que dicen.' : '🗣️ ¡Voces prendidas!', 'ok', 2600);
    if (!callado && !sesion) v.hablar('¡Listo, ya tengo voz!', { id: 'recepcion' });
  });
  addEventListener('voz:silencio', pintarVoz);
  addEventListener('voz:aviso', ev => { const m = ev.detail?.mensaje; if (m) toast(m, 'info', 6000); });
  pintarVoz();

  /* ------------------------------------------------------------------ */
  /* Bucle propio (corre después del del juego en cada cuadro)           */
  /* ------------------------------------------------------------------ */

  // Al abrir o cerrar cualquier ventana: la reunión se pausa y el dictado de una ventana cerrada se apaga
  new MutationObserver(() => {
    if (dictado && !dictado.el.isConnected) dictado.parar(true);
    if (sesion && sesion.modo === 'reunion' && modalOpen && !sesion.pausada) {
      pausar(sesion, '⏸ Pausé la reunión mientras ves la ventana. Pulsa ▶ SEGUIR para continuar.');
    }
  }).observe(document.querySelector('#modal'), { childList: true });

  function cuadro(time) {
    requestAnimationFrame(cuadro);
    pintarCapa(time);
  }
  function pintarCapa(time) {
    if (globo && globo.hasta && time > globo.hasta) globo = null;
    if (!globo && !sucio) return;
    if (capa.width !== canvas.width || capa.height !== canvas.height) { capa.width = canvas.width; capa.height = canvas.height; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, capa.width, capa.height);
    sucio = false;
    if (!globo || !map) return;
    sucio = true;
    dibujarGlobo(globo, time);
  }
  requestAnimationFrame(cuadro);

  // Para probar desde la consola
  window.VozOficina = { reporte, reunion, escucharReporte, terminar: () => terminar(sesion), pintarCapa, get sesion() { return sesion; }, get globo() { return globo; } };
})();
