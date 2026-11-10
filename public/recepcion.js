'use strict';
/* Oficina de chats — Recepción: responder a los hilos que te esperan sin caminar hasta su escritorio.
   Todo envío pasa por confirmSend: el servidor arma el texto con su contexto «[Oficina] …»,
   se muestra tal cual y solo se manda si dices que sí. Usa las piezas de game.js (openModal, sendAction, toast…). */

const sentReplies = new Map(); // id del hilo -> { ask, answer, at }: lo que ya respondiste desde aquí

function delicateNote() {
  return `<p class="aviso-delicado">⚠️ <b>Acción delicada.</b> Aunque respondas desde aquí, el hilo te pedirá confirmarlo
    directamente en su chat: la oficina no sirve para aprobar subir, publicar, desplegar, borrar o pagar.</p>`;
}

function replyLabel(label) {
  if (label === 'Sí') return '👍 Sí';
  if (label === 'No') return '✋ No';
  return `💬 ${label}`;
}

function replyCard(t) {
  const sent = sentReplies.get(t.id);
  const fresh = sent && sent.ask === t.ask;
  const replies = t.replies || [];
  return `
    <article class="reply-card" data-card="${esc(t.id)}">
      <div class="rc-head">
        <span class="rc-avatar" data-avatar></span>
        <div class="rc-who"><b>${esc(cut(t.title, 70))}</b><span>🏢 ${esc(t.project.name)} · ${esc(ago(t.updated))}</span></div>
      </div>
      <div class="rc-ask">🔔 ${rich(t.ask || 'Te espera.')}</div>
      ${t.recap ? `<div class="rc-recap">📝 ${rich(cut(t.recap, 200))}</div>` : ''}
      ${t.delicate ? delicateNote() : ''}
      ${fresh ? `<p class="rc-sent">✉️ Ya le respondiste «${esc(cut(sent.answer, 60))}» ${esc(ago(new Date(sent.at).toISOString()))}. Puedes mandar otra respuesta si quieres.</p>` : ''}
      <div class="rc-actions">
        ${t.canMessage
          ? `${replies.map((r, i) => `<button class="pixel-btn reply" data-reply="${i}">${esc(replyLabel(r.label))}</button>`).join('')}
             <button class="pixel-btn" data-write>✍️ Escribir respuesta</button>`
          : '<span class="note">No está abierto en la app: respóndele directamente en Claude.</span>'}
        <span class="grow"></span>
        <button class="pixel-btn ghost" data-go>🚶 Ir a su escritorio</button>
      </div>
      <div class="rc-write"></div>
    </article>`;
}

function bindCards(box) {
  box.querySelectorAll('[data-card]').forEach(card => {
    const id = card.dataset.card;
    const t = allThreads().find(x => x.id === id);
    if (!t) return;
    card.querySelector('[data-avatar]')?.replaceWith(avatarCanvas(t));
    const what = `Respuesta a «${cut(t.title, 30)}»`;
    const answer = async text => {
      if (!(await confirmSend({ threadId: id, kind: 'reply', ask: t.ask, message: text }, what))) return false;
      sentReplies.set(id, { ask: t.ask, answer: text, at: Date.now() });
      card.classList.add('done');
      card.querySelector('.rc-sent')?.remove();
      card.querySelector('.rc-actions').insertAdjacentHTML('beforebegin', `<p class="rc-sent">✉️ Enviado: «${esc(cut(text, 60))}». Cuando el hilo lo tome, deja de esperarte.</p>`);
      card.querySelector('.rc-write').innerHTML = '';
      return true;
    };
    card.querySelectorAll('[data-reply]').forEach(b => b.addEventListener('click', () => answer(t.replies[Number(b.dataset.reply)].answer)));
    card.querySelector('[data-write]')?.addEventListener('click', () => {
      const slot = card.querySelector('.rc-write');
      if (!slot.innerHTML) {
        slot.innerHTML = `
          <textarea class="say" placeholder="Escribe tu respuesta a su pregunta…" aria-label="Respuesta para «${esc(cut(t.title, 40))}»"></textarea>
          <div class="foot-row"><button class="pixel-btn primary" data-review>👀 REVISAR Y ENVIAR</button>
            <button class="pixel-btn ghost" data-cancel>Cancelar</button><span class="note">Ctrl+Enter</span></div>`;
        const say = slot.querySelector('textarea');
        const review = () => { const m = say.value.trim(); if (!m) { say.focus(); return; } answer(m); };
        slot.querySelector('[data-review]').addEventListener('click', review);
        slot.querySelector('[data-cancel]').addEventListener('click', () => { slot.innerHTML = ''; });
        say.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) review(); });
      }
      slot.querySelector('textarea').focus();
    });
    card.querySelector('[data-go]').addEventListener('click', () => { closeModal(); goToThread(id); });
  });
}

/* ---- Recepción (también la abre el botón 🔔 de arriba) ---- */
function openReception() {
  if (!world) return;
  const all = allThreads();
  const waiting = all.filter(t => t.status === 'espera');
  const working = all.filter(t => t.status === 'trabajando');
  openModal(`
    <header class="modal-head"><div><h2>${XMAS ? '🎅' : '🛎️'} RECEPCIÓN</h2><div class="sub">${waiting.length ? `¡Hola! ${waiting.length === 1 ? 'Un hilo te espera' : `${waiting.length} hilos te esperan`}: respóndeles desde aquí` : '¡Hola! Esto es lo que pasa en la oficina'}</div></div>
      ${typeof premiumOn === "function" && premiumOn() ? '<button class="pixel-btn mini premium-say" data-premium-say title="La recepcionista te lo cuenta con su voz de ElevenLabs (gasta créditos)">🔊 Que me lo diga</button>' : ''}
      <button class="pixel-btn close" data-close aria-label="Cerrar">✕</button></header>
    <div class="modal-body">
      <div class="stats">
        <div class="stat"><b style="color:var(--green)">${working.length}</b><span>trabajando</span></div>
        <div class="stat"><b style="color:var(--orange)">${waiting.length}</b><span>te esperan</span></div>
        <div class="stat"><b>${world.projects.length}</b><span>oficinas</span></div>
        <div class="stat"><b>${all.length}</b><span>hilos</span></div>
      </div>
      <div class="box ${waiting.length ? 'warnbox' : ''}"><h3>🔔 TE ESPERAN</h3>${waiting.length ? `<div class="reply-cards">${waiting.map(replyCard).join('')}</div>` : '<p class="empty">Nadie te está esperando. ¡Todo al día!</p>'}</div>
      <div class="box"><h3>⚡ TRABAJANDO AHORA</h3>${working.length ? `<div class="rows">${working.map(t => threadRow(t)).join('')}</div>` : '<p class="empty">Ningún hilo está trabajando en este momento.</p>'}</div>
    </div>
    <footer class="modal-foot avisos-foot"></footer>`, box => {
    bindRows(box);
    bindCards(box);
    if (typeof avisarVentana === "function") avisarVentana("recepcion", box);
    if (typeof bindSpeakButton === "function") bindSpeakButton(box.querySelector("[data-premium-say]"), () => {
      const k = working.length, w = waiting.length;
      let s = `¡Hola! Ahora hay ${k === 0 ? 'ningún hilo trabajando' : k === 1 ? 'un hilo trabajando' : `${k} hilos trabajando`}`;
      s += w ? ` y ${w === 1 ? 'uno te espera' : `${w} te esperan`}. El primero es «${shortText(waiting[0].title, 60)}».` : ' y nadie te espera. ¡Todo al día!';
      return s;
    }, 'recepcion'); // botón «Reunión de la mañana» (voz-oficina.js)
    if (typeof mountAvisosControls === 'function') mountAvisosControls(box.querySelector('.avisos-foot'));
  });
}

/* ---- Confirmar antes de enviar ---- */
let confirmOpen = null; // función para cerrar la confirmación abierta

/** Pide al servidor el texto exacto (sin encolar nada), lo muestra y solo lo envía si confirmas. */
async function confirmSend(payload, what) {
  const body = { ...payload, type: 'send' };
  let pre;
  try {
    const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Oficina-Token': TOKEN }, body: JSON.stringify({ ...body, preview: true }) });
    pre = await r.json();
    if (!r.ok) { toast(`${what}: ${pre.error || 'no se pudo'}`, 'error'); return false; }
  } catch {
    toast(`${what}: no pude hablar con el servidor.`, 'error');
    return false;
  }
  if (!(await askConfirm(pre))) return false;
  return Boolean(await sendAction(body, what));
}

function askConfirm(pre) {
  confirmOpen?.(false);
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'confirm-back';
    back.innerHTML = `
      <section class="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="cf-title">
        <header class="modal-head"><div><h2 id="cf-title">📨 ¿LO ENVÍO ASÍ?</h2><div class="sub">Para «${esc(cut(pre.title || '', 60))}»</div></div></header>
        <div class="modal-body">
          <p class="note cf-lead">Este es el texto exacto que le llega al hilo:</p>
          <pre class="cf-exact">${esc(pre.message)}</pre>
          ${pre.delicate ? delicateNote() : ''}
          <p class="note">Le llega como mensaje de la sesión «Oficina», no como si lo escribieras en su chat.</p>
        </div>
        <footer class="modal-foot"><div class="foot-row">
          <button class="pixel-btn primary" data-yes>✅ SÍ, ENVIAR</button>
          <button class="pixel-btn ghost" data-no>↩ VOLVER</button>
        </div></footer>
      </section>`;
    const done = ok => {
      if (confirmOpen !== done) return;
      confirmOpen = null;
      back.remove();
      resolve(ok);
    };
    confirmOpen = done;
    back.addEventListener('mousedown', ev => { if (ev.target === back) done(false); });
    back.querySelector('[data-yes]').addEventListener('click', () => done(true));
    back.querySelector('[data-no]').addEventListener('click', () => done(false));
    document.body.append(back);
    back.querySelector('[data-yes]').focus();
  });
}

// Esc cierra solo la confirmación (no la ventana de abajo)
addEventListener('keydown', ev => {
  if (!confirmOpen) return;
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); confirmOpen(false); }
}, true);
