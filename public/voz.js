'use strict';
/* Voz de la oficina — motor gratuito del navegador (Edge / Chromium).
   Habla con speechSynthesis (prefiere las voces neuronales «Natural»/«Online» de Edge)
   y escucha con SpeechRecognition. Se carga antes de game.js.

   API (otro motor, p. ej. ElevenLabs, puede reemplazar window.Voz con la misma forma):
     Voz.motor             'navegador'
     Voz.puedeHablar       true si el navegador sabe hablar
     Voz.puedeEscuchar     true si el navegador sabe dictar
     Voz.hablar(texto, { id, onFrase }) → Promise<{ ok, motivo? }>
        id: quién habla. 'santa' y 'recepcion' tienen voz propia; cualquier otro id
            (el id del hilo) recibe una voz, tono y velocidad estables según su hash.
        onFrase(i, frase, frases): se llama al empezar cada frase (para los subtítulos).
        Nunca rechaza. Si está silenciado o no hay voz en español, no suena pero espera
        el tiempo de lectura de cada frase, para que los subtítulos se alcancen a leer.
        motivo: 'callado' | 'silenciado' | 'sin-soporte' | 'sin-voces' | 'error'
     Voz.callar()          corta lo que esté diciendo (la promesa resuelve con motivo 'callado')
     Voz.escuchar({ onParcial, onFinal, onError }) → función para detener
        onParcial(texto)   texto acumulado (definitivo + provisional) mientras hablas
        onError(mensaje, codigo)  mensaje amable en español; llega antes de onFinal
        onFinal(texto)     una sola vez al terminar, aunque sea vacío
     Voz.silenciado        true si el usuario apagó las voces (se recuerda en localStorage)
     Voz.silenciar(bool)   apaga o prende las voces; avisa con el evento 'voz:silencio'
     Voz.frases(texto)     cómo se parte un texto en frases
     Voz.vozDe(id)         nombre de la voz que le toca a ese id (o null)
     Voz.estado()          { motor, voces, espanol, naturales, silenciado, … }
     Voz.listo             promesa que se cumple cuando ya cargaron las voces
   Eventos en window: 'voz:aviso' { mensaje, codigo } para avisos amables (se muestran como toast). */

(() => {
  const synth = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null;
  const Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const CLAVE = 'oficina-voz-silencio';

  let silenciado = false;
  try { silenciado = localStorage.getItem(CLAVE) === '1'; } catch {}

  const hashVoz = s => { let a = 7; for (const c of String(s)) a = (a * 31 + c.charCodeAt(0)) | 0; return Math.abs(a); };
  const avisados = new Set();
  function avisar(codigo, mensaje) {
    if (avisados.has(codigo)) return;
    avisados.add(codigo);
    window.dispatchEvent(new CustomEvent('voz:aviso', { detail: { codigo, mensaje } }));
  }

  /* ---------------- Voces ---------------- */

  let voces = [];
  let espanol = [];
  const rotas = new Set(); // voces que fallaron (p. ej. las «Online» sin internet)
  const natural = v => /natural|online|neural/i.test(v.name);
  const idVoz = v => v.voiceURI || v.name;
  const nombreDe = v => v.name.replace(/^(Microsoft|Google)\s+/i, '').split(/[\s(-]/)[0];
  const MUJERES = /^(salome|elvira|dalia|helena|laura|sabina|paloma|elena|camila|catalina|belkys|andrea|ximena|ana|abril|irene|estrella|larissa|beatriz|renata|candela|carlota|nuria|valentina|paola|karla|tania|margarita|lupe|monica|paulina|sofia|marisol|yolanda|teresa|sara|vera|triana|maria|lucia|isabel|carmen|marta|julia|emilia|luciana|gabriela|veronica|ramona|nayeli|lia|penelope|esperanza|carla|elsa)$/i;
  const HOMBRES = /^(gonzalo|alvaro|jorge|tomas|pablo|raul|emilio|gerardo|andres|federico|alex|arnau|dario|elias|saul|nil|teo|carlos|luciano|yago|mateo|sebastian|juan|marcelo|javier|victor|rodrigo|lorenzo|mario|manuel|eduardo|roberto|rafael|diego|cecilio|liberto|ivan|alonso|enrique|jose|luis|miguel|pedro|antonio|francisco|alberto|fernando|ricardo|santiago|gael|pelayo|jaime|hector|julio)$/i;
  const genero = v => { const n = nombreDe(v).normalize('NFD').replace(/[̀-ͯ]/g, ''); return MUJERES.test(n) ? 'f' : HOMBRES.test(n) ? 'm' : '?'; };

  function cargarVoces() {
    if (!synth) return;
    try { voces = synth.getVoices() || []; } catch { voces = []; }
    espanol = voces.filter(v => /^es([-_]|$)/i.test(v.lang || '')).sort((a, b) => idVoz(a).localeCompare(idVoz(b)));
  }
  const listo = new Promise(resolver => {
    if (!synth) return resolver();
    cargarVoces();
    if (voces.length) return resolver();
    const fin = () => { cargarVoces(); resolver(); };
    try { synth.addEventListener('voiceschanged', fin, { once: true }); } catch {}
    setTimeout(fin, 2500); // algunos navegadores nunca avisan
  });
  try { synth?.addEventListener('voiceschanged', cargarVoces); } catch {}

  /** Las mejores voces en español disponibles: las neuronales si existen, si no todas las es-*. */
  function grupo() {
    const sanas = espanol.filter(v => !rotas.has(idVoz(v)));
    const naturales = sanas.filter(natural);
    return naturales.length ? naturales : sanas;
  }

  const ESPECIALES = {
    santa: { genero: 'm', prefiere: ['gonzalo', 'jorge', 'alvaro', 'tomas'], tono: 0.72, vel: 0.9 },
    recepcion: { genero: 'f', prefiere: ['salome', 'dalia', 'elvira', 'helena', 'sabina'], tono: 1.08, vel: 1.04 },
  };
  function especial(nombre, lista) {
    const e = ESPECIALES[nombre];
    const pref = e.prefiere.map(n => lista.find(v => nombreDe(v).toLowerCase() === n)).find(Boolean);
    const voz = pref || lista.find(v => genero(v) === e.genero) || lista[0];
    return voz ? { voz, tono: e.tono, vel: e.vel } : null;
  }
  function elegir(id) {
    const lista = grupo();
    if (!lista.length) return null;
    if (ESPECIALES[id]) return especial(id, lista);
    // Los empleados no usan las voces de Santa ni de la recepcionista si hay de dónde escoger
    const reservadas = new Set(Object.keys(ESPECIALES).map(k => especial(k, lista)?.voz));
    const libres = lista.length > 4 ? lista.filter(v => !reservadas.has(v)) : lista;
    const h = hashVoz(id);
    return { voz: libres[h % libres.length], tono: 0.92 + ((h >> 5) % 7) * 0.03, vel: 0.96 + ((h >> 9) % 5) * 0.025 };
  }

  /* ---------------- Texto ---------------- */

  function frases(texto) {
    const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
    if (!limpio) return [];
    const out = [];
    for (let f of limpio.split(/(?<=[.!?…])\s+/)) {
      while (f.length > 220) { // corta las frases larguísimas por una coma o un espacio
        let k = f.lastIndexOf(', ', 200);
        if (k < 80) k = f.lastIndexOf(' ', 200);
        if (k < 40) k = 200;
        out.push(f.slice(0, k + 1).trim());
        f = f.slice(k + 1).trim();
      }
      if (out.length && out[out.length - 1].length < 18) out[out.length - 1] += ' ' + f; // «¡Jo jo jo!» va con la siguiente
      else if (f) out.push(f);
    }
    return out;
  }
  const paraDecir = s => String(s)
    .replace(/https?:\/\/\S+/g, 'un enlace')
    .replace(/[`*#>]+/g, '')
    .replace(/_/g, ' ')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const tiempoLectura = s => Math.max(1800, 700 + String(s).length * 55);

  /* ---------------- Hablar ---------------- */

  let turno = 0;          // cada hablar() o callar() abre un turno nuevo
  let pendiente = null;   // resolve del hablar() en curso
  let cortarEspera = null;
  let enCurso = null;     // referencia viva al enunciado (Chrome pierde onend si se recolecta)

  function callar() {
    turno++;
    if (synth) { try { synth.cancel(); } catch {} }
    if (cortarEspera) cortarEspera();
    if (pendiente) { const r = pendiente; pendiente = null; r({ ok: false, motivo: 'callado' }); }
  }

  function esperar(ms) {
    return new Promise(resolver => {
      const fin = () => { clearTimeout(t); if (cortarEspera === fin) cortarEspera = null; resolver(); };
      const t = setTimeout(fin, ms);
      cortarEspera = fin;
    });
  }

  /** Dice una frase. Resuelve 'ok', 'callado', 'silenciado' o 'error'. */
  function decir(texto, { voz, tono, vel }, mio) {
    return new Promise(resolver => {
      let hecho = false;
      const u = new SpeechSynthesisUtterance(texto);
      const fin = r => {
        if (hecho) return;
        hecho = true;
        clearTimeout(guardia);
        if (enCurso === u) enCurso = null;
        resolver(r);
      };
      u.voice = voz; u.lang = voz.lang; u.pitch = tono; u.rate = vel; u.volume = 1;
      u.onend = () => fin(mio !== turno ? 'callado' : silenciado ? 'silenciado' : 'ok');
      u.onerror = ev => {
        if (mio !== turno) return fin('callado');
        if (silenciado) return fin('silenciado');
        if (ev.error === 'interrupted' || ev.error === 'canceled') return fin('callado');
        rotas.add(idVoz(voz)); // no la vuelvo a usar en esta visita
        fin('error');
      };
      // Por si el navegador nunca avisa que terminó
      const guardia = setTimeout(() => fin('ok'), tiempoLectura(texto) * 2.5 + 5000);
      enCurso = u;
      try { synth.resume(); synth.speak(u); } catch { fin('error'); }
    });
  }

  function hablar(texto, { id = 'oficina', onFrase } = {}) {
    callar();
    const mio = turno;
    const lista = frases(texto);
    if (!lista.length) return Promise.resolve({ ok: true });
    return new Promise(resolver => {
      pendiente = resolver;
      (async () => {
        await listo;
        let sono = false;
        let motivo = null;
        for (let i = 0; i < lista.length; i++) {
          if (mio !== turno) return;
          try { onFrase?.(i, lista[i], lista); } catch {}
          const dicho = paraDecir(lista[i]);
          let r = null;
          for (let intento = 0; intento < 2 && dicho; intento++) {
            const eleccion = !silenciado && synth ? elegir(id) : null;
            if (!eleccion) break;
            r = await decir(dicho, eleccion, mio);
            if (r !== 'error') break;
            avisar('voz-rota', 'Una voz no respondió (¿sin internet?). Pruebo con otra.');
          }
          if (mio !== turno) return;
          if (r === 'ok') { sono = true; continue; }
          if (r === 'callado') continue; // otra pestaña o el sistema cortó la frase: sigo con la próxima
          if (r === 'error') motivo = 'error';
          else if (r === 'silenciado') motivo = motivo || 'silenciado';
          else if (!r) {
            motivo = motivo || (silenciado ? 'silenciado' : !synth ? 'sin-soporte' : 'sin-voces');
            if (motivo === 'sin-soporte') avisar('sin-soporte', 'Este navegador no sabe hablar: te muestro solo los subtítulos. Microsoft Edge trae voces gratis.');
            if (motivo === 'sin-voces') avisar('sin-voces', 'No encontré voces en español en este navegador, así que te muestro solo los subtítulos. Microsoft Edge trae voces naturales gratis.');
          }
          await esperar(tiempoLectura(lista[i])); // sin sonido: tiempo para leer el globo
        }
        if (mio !== turno) return;
        pendiente = null;
        resolver(sono && !motivo ? { ok: true } : { ok: sono, motivo: motivo || 'error' });
      })();
    });
  }

  function silenciar(valor = !silenciado) {
    silenciado = !!valor;
    try { localStorage.setItem(CLAVE, silenciado ? '1' : '0'); } catch {}
    if (silenciado && synth) { try { synth.cancel(); } catch {} } // la frase actual se corta; el resto sigue como subtítulo
    window.dispatchEvent(new CustomEvent('voz:silencio', { detail: { silenciado } }));
    return silenciado;
  }

  /* ---------------- Escuchar ---------------- */

  const ERRORES = {
    'sin-soporte': 'Este navegador no sabe dictar. Abre la oficina en Microsoft Edge o Chrome para hablarle.',
    'not-allowed': 'No tengo permiso para usar el micrófono. Dale permiso en el candado 🔒 junto a la dirección y prueba otra vez.',
    'service-not-allowed': 'Aquí no me dejan usar el dictado. Prueba abriendo la oficina en Microsoft Edge o Chrome.',
    'audio-capture': 'No encontré ningún micrófono. ¿Está conectado?',
    'no-speech': 'No alcancé a oírte. Acércate al micrófono y prueba otra vez.',
    'network': 'El dictado de este navegador necesita un servicio en línea que no respondió. En Microsoft Edge con internet funciona.',
    'language-not-supported': 'Este navegador no sabe dictar en español.',
    'no-arranca': 'No pude encender el micrófono. Prueba otra vez en un momento.',
  };

  function escuchar({ onParcial, onFinal, onError } = {}) {
    let terminado = false;
    let detenido = false;
    let reintentar = false;
    let rec = null;
    let texto = '';
    const idiomas = ['es-CO', 'es-ES'];
    let k = 0;
    const acabar = () => { if (terminado) return; terminado = true; try { onFinal?.(texto); } catch {} };
    const fallar = codigo => { try { onError?.(ERRORES[codigo] || `El dictado falló (${codigo}). Prueba otra vez.`, codigo); } catch {} };

    if (!Reconocedor) { setTimeout(() => { fallar('sin-soporte'); acabar(); }); return () => {}; }
    callar(); // que la oficina no se escuche a sí misma

    const arrancar = () => {
      rec = new Reconocedor();
      rec.lang = idiomas[k];
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = ev => {
        let definitivo = '', provisional = '';
        for (let i = 0; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) definitivo += r[0].transcript + ' ';
          else provisional += r[0].transcript + ' ';
        }
        texto = (definitivo + provisional).replace(/\s+/g, ' ').trim();
        try { onParcial?.(texto); } catch {}
      };
      rec.onerror = ev => {
        if (ev.error === 'language-not-supported' && k < idiomas.length - 1) { k++; reintentar = true; return; }
        if (ev.error === 'aborted' && detenido) return;
        fallar(ev.error);
      };
      rec.onend = () => {
        if (reintentar && !detenido) {
          reintentar = false;
          try { arrancar(); return; } catch { fallar('no-arranca'); }
        }
        acabar();
      };
      rec.start();
    };
    try { arrancar(); } catch { setTimeout(() => { fallar('no-arranca'); acabar(); }); }

    return () => {
      if (detenido) return;
      detenido = true;
      try { rec?.stop(); } catch {}
      setTimeout(acabar, 2500); // por si onend nunca llega
    };
  }

  window.Voz = {
    motor: 'navegador',
    puedeHablar: !!synth,
    puedeEscuchar: !!Reconocedor,
    hablar,
    callar,
    escuchar,
    get silenciado() { return silenciado; },
    silenciar,
    frases,
    listo,
    vozDe(id) { const e = elegir(id); return e ? `${e.voz.name} (${e.voz.lang})` : null; },
    estado() {
      return {
        motor: 'navegador', puedeHablar: !!synth, puedeEscuchar: !!Reconocedor, silenciado,
        voces: voces.length, espanol: espanol.length, naturales: espanol.filter(natural).length, rotas: rotas.size,
      };
    },
  };
})();
