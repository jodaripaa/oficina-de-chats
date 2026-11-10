// Oficina de chats — lo que sale de la oficina hacia los hilos, en un solo lugar:
//  · el contexto «[Oficina] …» que llevan todos los mensajes (para que el hilo sepa de dónde vienen y a qué responden),
//  · las respuestas sugeridas a la pregunta de un hilo,
//  · la detección de acciones delicadas (subir, push, publicar, desplegar, borrar, pagar…).
// La oficina no se hace pasar por la persona ni da aprobaciones: solo pasa el mensaje con su contexto.
'use strict';

const TAG = '[Oficina]';
const flat = t => String(t || '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const cap = s => (s ? s[0].toLocaleUpperCase('es') + s.slice(1) : s);

/* ---- Acciones delicadas ---- */

const DELICATE_WORDS = [
  'sub(?:ir|o|e|a|es|as|en|an|amos|imos|irlo|irla|irlos|irlas|ido|ida|idos|idas)', 's[úu]bel[oa]s?', 's[úu]banl[oa]s?',
  'push\\w*', 'pushe\\w*',
  'publi(?:car|co|ca|cas|can|que|quen|quemos|carlo|carla|carlos|cado|cada|cados|cadas|caci[óo]n|sh\\w*)',
  'despleg\\w*', 'desplieg\\w*', 'deploy\\w*',
  'borr(?:ar|o|a|as|an|e|en|emos|amos|arlo|arla|arlos|arlas|ado|ada|ados|adas)', 'b[óo]rral[oa]s?',
  'elimin(?:ar|o|a|as|an|e|en|emos|amos|arlo|arla|arlos|arlas|ado|ada|ados|adas)', 'delete\\w*',
  'pag(?:ar|o|a|as|an|ue|uen|amos|arlo|arla|ado|ada)', 'p[áa]gal[oa]', 'pay(?:ment|ments|ing)?',
  'pull request', 'release',
];
const DELICATE_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${DELICATE_WORDS.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
const PR_RE = /(?<![\p{L}\p{N}])PRs?(?![\p{L}\p{N}])/u; // «abrir un PR» (en mayúsculas, para no confundir)

/** ¿El texto habla de algo que no se aprueba desde la oficina? */
function isDelicate(text) {
  const s = String(text || '');
  return DELICATE_RE.test(s) || PR_RE.test(s);
}

/* ---- Respuestas sugeridas ---- */

const OPEN_RE = /^(?:qué|cuál|cuáles|cómo|cuándo|dónde|adónde|quién|quiénes|cuánto|cuánta|cuántos|cuántas|por qué|para qué|which|what|how|when|where|who|why)(?![\p{L}])/iu;

/** La pregunta en sí: el último «¿…?» del texto, o la última frase que termina en «?». */
function questionOf(ask) {
  const s = flat(ask);
  const all = [...s.matchAll(/¿([^¿?]*)\?/g)];
  if (all.length) return all[all.length - 1][1].trim();
  const m = s.match(/([^.!?¿]*)\?\s*$/);
  return (m ? m[1] : s).trim().replace(/[?.]+$/, '');
}

/** «¿A o B?», «¿A, B o C?», «¿Sigo con X o con Y?», «¿Cuál primero: A o B?» → opciones. */
function parseOptions(q) {
  let body = q;
  const colon = body.lastIndexOf(':');
  if (colon >= 0 && colon < body.length - 3) body = body.slice(colon + 1);
  if (!/\s(?:o|u|or)\s/i.test(` ${body} `)) return null;
  let parts = body.split(/\s*,?\s+(?:o|u|or)\s+/i);
  if (parts.length === 2 && parts[0].includes(',')) parts = [...parts[0].split(/\s*,\s*/), parts[1]];
  parts = parts.map(p => p.trim().replace(/^[,;:]+|[,;:.]+$/g, '').trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4 || parts.some(p => p.length > 60)) return null;
  if (/^(?:no|not|nada)\b/i.test(parts[parts.length - 1])) return null; // «¿Lo subo o no?» es un sí/no

  // Quitar el verbo que comparten: «Sigo con el bloque B» / «con el C» → «con el bloque B» / «con el C»
  const words = s => s.split(/\s+/);
  const rest = parts.slice(1);
  const lead = words(rest[0])[0].toLowerCase();
  const w0 = words(parts[0]);
  let idx = -1;
  for (let i = w0.length - 1; i > 0; i--) if (w0[i].toLowerCase() === lead) { idx = i; break; }
  if (idx > 0 && rest.every(r => words(r)[0].toLowerCase() === lead)) parts[0] = w0.slice(idx).join(' ');
  else if (w0.length > 1 && rest.every(r => words(r).length === 1)) parts[0] = w0[w0.length - 1]; // «¿Uso React o Vue?»

  const seen = new Set();
  return parts.map(cap).filter(p => { const k = p.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Botones de respuesta para la pregunta de un hilo: [{ label, answer }].
 * 1) los que el propio hilo propuso al cerrar su turno; 2) las opciones de la pregunta; 3) «Sí» / «No».
 * Para preguntas abiertas («¿Cuál…?», «¿Cómo…?») sin opciones no hay botones: se escribe la respuesta.
 */
function suggestReplies(ask, threadLabels) {
  const own = (threadLabels || []).map(flat).filter(Boolean).slice(0, 4);
  if (own.length) return own.map(l => ({ label: cut(l, 40), answer: l }));
  const q = questionOf(ask);
  const opts = parseOptions(q);
  if (opts && opts.length > 1) return opts.map(o => ({ label: cut(o, 40), answer: o }));
  if (OPEN_RE.test(q)) return [];
  return [{ label: 'Sí', answer: 'Sí' }, { label: 'No', answer: 'No' }];
}

/* ---- El mensaje que llega al hilo ---- */

const DELICATE_NOTE = '(Llega desde la oficina y no es una aprobación: si esto implica subir, hacer push, publicar, desplegar, borrar o pagar, pide la confirmación directamente en este chat.)';
const sentence = s => (/\n/.test(s) || /[.!?…)»"'”]$/.test(s) ? s : `${s}.`);

/**
 * Arma el texto exacto que recibe el hilo.
 *  kind 'reply'       → «[Oficina] Respuesta a tu pregunta «¿Sigo con el bloque B?»: Sí.»
 *  kind 'instruction' → «[Oficina] Instrucción: Continúa con el siguiente paso de tu lista.»
 *  kind 'broadcast'   → «[Oficina] Pedido de avance: Dame un resumen corto…»
 */
function composeMessage({ kind, message, ask } = {}) {
  const text = String(message || '').trim();
  if (!text) return '';
  if (text.startsWith(TAG)) return text; // ya trae su contexto
  const q = cut(flat(ask), 300);
  let out;
  if (kind === 'reply' && q) out = `${TAG} Respuesta a tu pregunta «${q}»: ${sentence(text)}`;
  else if (kind === 'broadcast') out = `${TAG} Pedido de avance: ${sentence(text)}`;
  else out = `${TAG} Instrucción: ${sentence(text)}`;
  const declines = /^(?:no|nop|ahora no|todavía no|aún no|mejor no)(?![\p{L}])/iu.test(text); // un «no» no aprueba nada
  if (!declines && isDelicate(kind === 'reply' ? `${q}\n${text}` : text)) out += `\n\n${DELICATE_NOTE}`;
  return out;
}

module.exports = { composeMessage, suggestReplies, isDelicate, questionOf, parseOptions, DELICATE_NOTE };
