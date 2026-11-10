import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type {
  OficinaData,
  OficinaProject,
  OficinaSend,
  OficinaStatus,
  OficinaThread,
  OficinaUi,
  OficinaView,
} from '../types'

const PANE = 'oficina'
const TITLE = '🏢 Oficina'
const REFRESH_MS = 15000
const TOOL = 'mcp__oficina__resumen'

const dataA = atom({ plugin: 'oficina', key: 'data' } as const, null as OficinaData | null, { shape: 'data-2' })
const viewA = atom({ plugin: 'oficina', key: 'view' } as const, { screen: 'home' } as OficinaView, { shape: 'view-1' })
const sendA = atom(
  { plugin: 'oficina', key: 'send' } as const,
  { count: 0, threadId: null, status: 'idle', detail: '' } as OficinaSend,
  { shape: 'send-1' },
)
const sleepA = atom({ plugin: 'oficina', key: 'showSleeping' } as const, false, { shape: 'sleep-1' })
const busyA = atom({ plugin: 'oficina', key: 'busy' } as const, false, { shape: 'busy-1' })
const reqA = atom({ plugin: 'oficina', key: 'requested' } as const, 0, { shape: 'req-1' })
const pinsA = atom({ plugin: 'oficina', key: 'pins' } as const, [] as string[], { shape: 'pins-1' })
const uiA = atom(
  { plugin: 'oficina', key: 'ui' } as const,
  { confirm: null, composing: null, notice: null } as OficinaUi,
  { shape: 'ui-1' },
)

/* ------------------------------------------------------------------ */
/* Textos, colores y utilidades                                         */
/* ------------------------------------------------------------------ */

const STATUS: Record<OficinaStatus, { label: string; short: string; emoji: string; color: string; screen: string; theme: string }> = {
  trabajando: { label: 'Trabajando ahora', short: 'trabajando', emoji: '⚡', color: '#22c55e', screen: '#4ade80', theme: 'success' },
  espera: { label: 'Te está esperando', short: 'te espera', emoji: '🔔', color: '#f97316', screen: '#fb923c', theme: 'warning' },
  hoy: { label: 'Activo hoy', short: 'hoy', emoji: '🔵', color: '#3b82f6', screen: '#60a5fa', theme: 'suggestion' },
  semana: { label: 'Esta semana', short: 'esta semana', emoji: '🟡', color: '#eab308', screen: '#fcd34d', theme: 'subtle' },
  dormido: { label: 'Dormido', short: 'dormido', emoji: '💤', color: '#94a3b8', screen: '#334155', theme: 'subtle' },
}
const ORDER: OficinaStatus[] = ['trabajando', 'espera', 'hoy', 'semana', 'dormido']
const ACCENTS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'hace un momento'
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const hrs = Math.round(m / 60)
  if (hrs < 24) return `hace ${hrs} h`
  const d = Math.round(hrs / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const xml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string)
const hash = (s: string) => {
  let acc = 0
  for (const c of s) acc = (acc * 31 + c.charCodeAt(0)) | 0
  return Math.abs(acc)
}
const norm = (p: string | null | undefined) => (p ?? '').replace(/[\\/]+$/, '').toLowerCase()
const accentOf = (key: string) => ACCENTS[hash(key) % ACCENTS.length] as string

function progressOf(t: OficinaThread) {
  if (!t.plan || !t.plan.length) return null
  const done = t.plan.filter(p => p.status === 'completed').length
  return { done, total: t.plan.length, pct: Math.round((done / t.plan.length) * 100) }
}
function projectProgress(p: OficinaProject) {
  let done = 0
  let total = 0
  for (const t of p.threads) {
    if (t.status === 'dormido') continue
    const pr = progressOf(t)
    if (pr) { done += pr.done; total += pr.total }
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}
const currentStep = (t: OficinaThread) => t.plan?.find(p => p.status === 'in_progress')?.content ?? null
const count = (p: OficinaProject, s: OficinaStatus) => p.threads.filter(t => t.status === s).length

/** Una línea que dice en qué está el hilo, lo más útil primero. */
function oneLiner(t: OficinaThread): string {
  if (t.status === 'espera' && t.ask) return `Pregunta: ${t.ask}`
  const step = currentStep(t)
  if (step && t.status !== 'dormido') return `Ahora: ${step}`
  if (t.recap) return t.recap
  return t.last ? `Tu último mensaje: ${t.last}` : 'Sin resumen todavía'
}

/* ------------------------------------------------------------------ */
/* Datos: hilos del disco + sesiones vivas de la app                   */
/* ------------------------------------------------------------------ */

type RawThread = {
  id: string; title: string | null; first: string | null; last: string | null; cwd: string | null
  branch: string | null; created: string; updated: string; msgs: number
  plan: OficinaThread['plan']; recap: string | null; ask: string | null; closed: boolean
  project: string; projectName: string; worktree: string | null
}
type LiveSession = { sessionId: string; title?: string; cwd?: string; isRunning?: boolean; lastActivityAt?: string; link?: string }
type ToolAnswer = { deny?: string; text?: string; isError?: boolean } | null

/** Arma la oficina a partir de la salida de collect.cjs y de list_sessions (puro, sin $). */
function buildData(stdout: string, liveAnswer: ToolAnswer): OficinaData {
  const raw = JSON.parse(stdout) as { generated: string; threads: RawThread[] }
  let live: LiveSession[] = []
  let isLive = false
  if (liveAnswer && !liveAnswer.deny && !liveAnswer.isError && liveAnswer.text) {
    const m = liveAnswer.text.match(/\[[\s\S]*\]/)
    if (m) {
      try { live = JSON.parse(m[0]); isLive = true } catch { /* sin datos en vivo */ }
    }
  }
  const now = Date.now()
  const used = new Set<string>()
  const threads: OficinaThread[] = raw.threads.map(r => {
    // Emparejar con la sesión de la app: misma carpeta y mismo título, o actividad cercana.
    const sameCwd = live.filter(s => !used.has(s.sessionId) && norm(s.cwd) === norm(r.cwd))
    let s = sameCwd.find(x => r.title && x.title === r.title)
    if (!s) {
      s = sameCwd
        .map(x => ({ x, d: Math.abs(new Date(x.lastActivityAt ?? 0).getTime() - new Date(r.updated).getTime()) }))
        .filter(o => o.d < 5 * 60e3)
        .sort((a, b) => a.d - b.d)[0]?.x
    }
    if (s) used.add(s.sessionId)
    const age = now - new Date(r.updated).getTime()
    let status: OficinaStatus
    if (s?.isRunning || (!isLive && age < 3 * 60e3)) status = 'trabajando'
    else if (r.closed && r.ask && age < 7 * 864e5) status = 'espera'
    else if (age < 864e5) status = 'hoy'
    else if (age < 7 * 864e5) status = 'semana'
    else status = 'dormido'
    return {
      id: r.id,
      title: s?.title || r.title || r.first || 'Hilo sin título',
      project: r.project, projectName: r.projectName, cwd: r.cwd, branch: r.branch, worktree: r.worktree,
      created: r.created, updated: r.updated, msgs: r.msgs, plan: r.plan, recap: r.recap,
      ask: r.closed ? r.ask : null, last: r.last, status,
      sessionId: s?.sessionId ?? null, link: s?.link ?? null,
    }
  })

  const byKey = new Map<string, OficinaProject>()
  for (const t of threads) {
    const key = t.project.toLowerCase()
    if (!byKey.has(key)) {
      byKey.set(key, { key, name: t.projectName, path: t.project.startsWith('__') ? null : t.project, updated: t.updated, threads: [] })
    }
    const p = byKey.get(key) as OficinaProject
    p.threads.push(t)
    if (t.updated > p.updated) p.updated = t.updated
  }
  const projects = [...byKey.values()].map(p => ({
    ...p,
    threads: p.threads.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updated.localeCompare(a.updated)),
  }))
  return { generated: raw.generated, isLive, error: null, projects }
}

function sortProjects(list: OficinaProject[], pins: string[]): OficinaProject[] {
  const rank = (p: OficinaProject) =>
    (pins.includes(p.key) ? 1e6 : 0) + count(p, 'trabajando') * 1e3 + count(p, 'espera') * 10
  return [...list].sort((a, b) => rank(b) - rank(a) || b.updated.localeCompare(a.updated))
}

/** El resumen en texto que lee Claude en el chat (herramienta "resumen"). */
function summaryText(d: OficinaData | null, onlyProject?: string): string {
  if (!d) return 'La oficina todavía está cargando los hilos; intenta de nuevo en unos segundos.'
  const all = d.projects.flatMap(p => p.threads)
  const lines: string[] = [
    `Oficina de proyectos (${ago(d.generated)}${d.isLive ? ', con estado en vivo de la app' : ''}): ${d.projects.length} proyectos, ${all.length} hilos.`,
    `Trabajando: ${all.filter(t => t.status === 'trabajando').length} · Esperan respuesta: ${all.filter(t => t.status === 'espera').length} · Activos hoy: ${all.filter(t => t.status === 'hoy').length}.`,
  ]
  if (d.error) lines.push(`Aviso: ${d.error}`)
  for (const p of d.projects) {
    if (onlyProject && !p.name.toLowerCase().includes(onlyProject.toLowerCase())) continue
    const pr = projectProgress(p)
    lines.push('', `## ${p.name}${p.path ? ` (${p.path})` : ''} — ${pr.total ? `${pr.done}/${pr.total} pasos (${pr.pct}%)` : 'sin listas de tareas'}`)
    const active = p.threads.filter(t => t.status !== 'dormido')
    for (const t of active) {
      const tp = progressOf(t)
      lines.push(`- ${STATUS[t.status].emoji} ${t.title} [${STATUS[t.status].short}, ${ago(t.updated)}${tp ? `, ${tp.done}/${tp.total} pasos` : ''}]${t.sessionId ? ` (session_id ${t.sessionId})` : ''}`)
      lines.push(`  ${cut(oneLiner(t), 300)}`)
    }
    const sleeping = p.threads.length - active.length
    if (sleeping) lines.push(`- 💤 ${sleeping} hilo(s) dormidos (sin actividad en más de 7 días)`)
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Dibujos SVG                                                          */
/* ------------------------------------------------------------------ */

const SHIRTS = ['#ef6f51', '#2a9d8f', '#8e7dbe', '#e9b949', '#457b9d', '#d1495b', '#5fa37a', '#f4a261', '#577590', '#c77d9b']
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac']
const HAIRS = ['#2b1d14', '#4a2f1b', '#6b4423', '#151515', '#a0522d', '#d4a017', '#7a7a7a']
const FONT = 'font-family="Segoe UI,system-ui,sans-serif"'

const SVG_STYLE = `<style>
.ty{animation:ty .5s steps(2) infinite;transform-box:fill-box;transform-origin:center bottom}
@keyframes ty{50%{transform:translateY(-1.6px)}}
.sc{animation:sc 2s ease-in-out infinite}@keyframes sc{50%{opacity:.7}}
.dt{animation:dt 1.2s infinite}.dt2{animation-delay:.2s}.dt3{animation-delay:.4s}@keyframes dt{0%,60%,100%{opacity:.25}30%{opacity:1}}
.bo{animation:bo 1.4s ease-in-out infinite;transform-box:fill-box}@keyframes bo{50%{transform:translateY(-2px)}}
.zz{animation:zz 2.6s ease-in-out infinite}@keyframes zz{0%{opacity:0;transform:translateY(2px)}40%{opacity:1}100%{opacity:0;transform:translateY(-8px)}}
.lit{animation:lit 3s ease-in-out infinite}@keyframes lit{50%{opacity:.7}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>`

function desk(t: OficinaThread, cx: number, y: number, w: number, label: boolean): string {
  const st = STATUS[t.status]
  const seed = hash(t.id)
  const shirt = SHIRTS[seed % SHIRTS.length]
  const skin = SKINS[(seed >> 3) % SKINS.length]
  const hair = HAIRS[(seed >> 6) % HAIRS.length]
  const present = t.status === 'trabajando' || t.status === 'espera' || t.status === 'hoy'
  const dw = Math.min(w - 10, 64)
  const px = cx - 9
  const mx = cx + 3
  const pr = progressOf(t)
  let g = `<g><title>${xml(t.title)} — ${st.label}${pr ? ` · ${pr.done}/${pr.total} pasos` : ''}</title>`
  g += `<rect x="${px - 9}" y="${y - 15}" width="18" height="21" rx="5" fill="#374151"/>`
  if (present) {
    g += `<g class="${t.status === 'trabajando' ? 'ty' : ''}"><rect x="${px - 8}" y="${y - 6}" width="16" height="14" rx="6" fill="${shirt}"/>`
    g += `<circle cx="${px}" cy="${y - 12}" r="6.5" fill="${skin}"/><path d="M${px - 6.5} ${y - 13} a6.5 6.5 0 0 1 13 0 q-6 -3 -13 0z" fill="${hair}"/></g>`
  }
  g += `<rect x="${cx - dw / 2}" y="${y + 4}" width="${dw}" height="7" rx="2" fill="#a8714c"/>`
  g += `<rect x="${cx - dw / 2 + 2}" y="${y + 11}" width="${dw - 4}" height="12" fill="#7c4a2d"/>`
  g += `<rect x="${mx}" y="${y - 12}" width="21" height="15" rx="2" fill="#1f2937"/>`
  g += `<rect class="${t.status === 'trabajando' ? 'sc' : ''}" x="${mx + 2}" y="${y - 10}" width="17" height="11" rx="1" fill="${st.screen}"/>`
  g += `<rect x="${mx + 8.5}" y="${y + 3}" width="4" height="2" fill="#1f2937"/>`
  if (pr) {
    g += `<rect x="${cx - dw / 2 + 3}" y="${y + 6.2}" width="${dw - 6}" height="2.6" rx="1.3" fill="rgba(0,0,0,.3)"/>`
    g += `<rect x="${cx - dw / 2 + 3}" y="${y + 6.2}" width="${((dw - 6) * pr.pct) / 100}" height="2.6" rx="1.3" fill="#4ade80"/>`
  }
  if (t.status === 'trabajando') {
    g += `<g transform="translate(${px - 4} ${y - 31})"><rect width="22" height="11" rx="5.5" fill="#fff" stroke="#d1d5db"/>`
    g += `<circle class="dt" cx="6" cy="5.5" r="1.6" fill="#16a34a"/><circle class="dt dt2" cx="11" cy="5.5" r="1.6" fill="#16a34a"/><circle class="dt dt3" cx="16" cy="5.5" r="1.6" fill="#16a34a"/></g>`
  } else if (t.status === 'espera') {
    g += `<g class="bo"><circle cx="${px + 2}" cy="${y - 27}" r="7" fill="#f97316"/><text x="${px + 2}" y="${y - 23.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff" ${FONT}>?</text></g>`
  } else if (t.status === 'dormido') {
    g += `<text class="zz" x="${cx - 6}" y="${y - 6}" font-size="10" fill="#94a3b8" ${FONT}>z</text>`
  }
  if (label) {
    g += `<text x="${cx}" y="${y + 33}" text-anchor="middle" font-size="7.5" fill="#3f3a34" ${FONT}>${xml(cut(t.title, Math.max(10, Math.floor(w / 4.6))))}</text>`
  }
  return g + '</g>'
}

function room(uid: string, W: number, top: number, wallH: number, floorH: number, accent: string): string {
  const hour = new Date().getHours()
  const night = hour < 6 || hour >= 19
  const fy = top + wallH
  return `<defs><pattern id="${uid}f" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#c99a6b"/><rect width="10" height="10" fill="#b8875a"/><rect x="10" y="10" width="10" height="10" fill="#b8875a"/></pattern>
<linearGradient id="${uid}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${night ? '#0f2742' : '#7cc4ec'}"/><stop offset="1" stop-color="${night ? '#29496b' : '#c9e8f7'}"/></linearGradient></defs>
<rect y="${top}" width="${W}" height="${wallH}" fill="#f6eddf"/>
<rect y="${top}" width="${W}" height="5" fill="${accent}" opacity=".35"/>
<rect y="${fy}" width="${W}" height="${floorH}" fill="url(#${uid}f)"/>
<rect y="${fy - 5}" width="${W}" height="5" fill="#d9c4a5"/>
<rect x="14" y="${top + 9}" width="54" height="${wallH - 22}" rx="3" fill="url(#${uid}s)" stroke="#7c4a2d" stroke-width="2.5"/>
<line x1="41" y1="${top + 9}" x2="41" y2="${fy - 13}" stroke="#7c4a2d" stroke-width="2"/>
${night ? `<circle cx="58" cy="${top + 18}" r="4" fill="#f8f3d4"/>` : `<circle cx="26" cy="${top + 19}" r="5" fill="#fde68a"/>`}
<rect x="${W - 46}" y="${fy - 22}" width="18" height="15" rx="3" fill="#b45309"/>
<ellipse cx="${W - 42}" cy="${fy - 30}" rx="6" ry="11" fill="#3f8f4f"/><ellipse cx="${W - 31}" cy="${fy - 32}" rx="6" ry="12" fill="#4caf63"/><ellipse cx="${W - 37}" cy="${fy - 38}" rx="5.5" ry="10" fill="#2f7a3f"/>`
}

/** Tarjeta de la portada: toda la oficina en un dibujo. */
function doorCardSvg(p: OficinaProject, pinned: boolean): string {
  const W = 360
  const H = 168
  const accent = accentOf(p.key)
  const uid = 'd' + hash(p.key)
  const pr = projectProgress(p)
  const shown = p.threads.filter(t => t.status !== 'dormido').slice(0, 5)
  const desks = shown.length ? shown : p.threads.slice(0, 3)
  const cw = W / Math.max(4, desks.length)
  const badges: string[] = []
  const w = count(p, 'trabajando')
  const q = count(p, 'espera')
  if (w) badges.push(`<tspan fill="#bbf7d0">⚡ ${w}</tspan>`)
  if (q) badges.push(`<tspan fill="#fed7aa">🔔 ${q}</tspan>`)
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${SVG_STYLE}
<defs><clipPath id="${uid}c"><rect width="${W}" height="${H}" rx="14"/></clipPath>
<linearGradient id="${uid}h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${accent}" stop-opacity=".75"/></linearGradient></defs>
<g clip-path="url(#${uid}c)">
<rect width="${W}" height="${H}" fill="#fffaf2"/>
<rect width="${W}" height="38" fill="url(#${uid}h)"/>
<text x="14" y="25" font-size="16" font-weight="800" fill="#fff" ${FONT}>${pinned ? '⭐ ' : ''}${xml(cut(p.name, 22))}</text>
<text x="${W - 14}" y="25" text-anchor="end" font-size="12.5" font-weight="700" ${FONT}>${badges.join('  ')}</text>
${room(uid, W, 38, 46, 46, accent)}`
  desks.forEach((t, i) => {
    const cx = (W - desks.length * cw) / 2 + i * cw + cw / 2
    s += desk(t, cx, 106, cw, false)
  })
  const barW = W - 28
  s += `<rect y="130" width="${W}" height="38" fill="#fffaf2"/>
<rect x="14" y="140" width="${barW}" height="8" rx="4" fill="#e7e5e4"/>
<rect x="14" y="140" width="${Math.max(pr.pct ? 8 : 0, (barW * pr.pct) / 100)}" height="8" rx="4" fill="${accent}"/>
<text x="14" y="162" font-size="10.5" fill="#57534e" ${FONT}>${pr.total ? `${pr.done}/${pr.total} pasos · ${pr.pct}%` : 'Sin listas de tareas'}  ·  ${p.threads.length} hilo${p.threads.length === 1 ? '' : 's'}</text>
<text x="${W - 14}" y="162" text-anchor="end" font-size="10.5" fill="#78716c" ${FONT}>${ago(p.updated)}</text>
</g></svg>`
  return s
}

/** La oficina grande, con un escritorio rotulado por hilo. */
function officeSvg(p: OficinaProject, threads: OficinaThread[]): string {
  const cols = threads.length > 8 ? 5 : 4
  const W = 360
  const wallH = 70
  const rowH = 62
  const rows = Math.max(1, Math.ceil(threads.length / cols))
  const H = wallH + rows * rowH + 12
  const cw = W / cols
  const uid = 'o' + hash(p.key)
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${SVG_STYLE}
<defs><clipPath id="${uid}c"><rect width="${W}" height="${H}" rx="14"/></clipPath></defs><g clip-path="url(#${uid}c)">
${room(uid, W, 0, wallH, H - wallH, accentOf(p.key))}
<rect x="88" y="14" width="150" height="36" rx="6" fill="#fffdf8" stroke="#a8a29e" stroke-width="1.5"/>
<text x="163" y="30" text-anchor="middle" font-size="12" font-weight="700" fill="#2f2a25" ${FONT}>${xml(cut(p.name, 20))}</text>
<text x="163" y="43" text-anchor="middle" font-size="8.5" fill="#78716c" ${FONT}>${threads.length} escritorio${threads.length === 1 ? '' : 's'}</text>`
  threads.forEach((t, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const inRow = Math.min(cols, threads.length - r * cols)
    const cx = (W - inRow * cw) / 2 + c * cw + cw / 2
    s += desk(t, cx, wallH + 26 + r * rowH, cw, true)
  })
  if (!threads.length) s += `<text x="${W / 2}" y="${wallH + 34}" text-anchor="middle" font-size="12" fill="#78716c" ${FONT}>Nadie trabajando esta semana</text>`
  return s + '</g></svg>'
}

function bannerSvg(d: OficinaData, projects: OficinaProject[]): string {
  const all = d.projects.flatMap(p => p.threads)
  const n = (s: OficinaStatus) => all.filter(t => t.status === s).length
  const floors = projects.slice(0, 6)
  const W = 360
  const H = 124
  const fh = floors.length ? Math.min(16, 84 / floors.length) : 16
  const bx = 20
  const bw = 104
  const top = H - 12 - floors.length * fh
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${SVG_STYLE}
<defs><linearGradient id="bn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#312e81"/><stop offset=".6" stop-color="#7c3aed"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs>
<rect width="${W}" height="${H}" rx="16" fill="url(#bn)"/>
<circle cx="330" cy="20" r="1.3" fill="#fff" opacity=".8"/><circle cx="210" cy="12" r="1" fill="#fff" opacity=".6"/><circle cx="150" cy="104" r="1" fill="#fff" opacity=".5"/>
<rect x="${bx - 4}" y="${H - 12}" width="${bw + 8}" height="3" fill="#1e1b4b"/>
<rect x="${bx + bw / 2 - 18}" y="${top - 11}" width="36" height="11" rx="2" fill="#1e1b4b"/>
<text x="${bx + bw / 2}" y="${top - 3}" text-anchor="middle" font-size="7" fill="#fde68a" font-weight="700" ${FONT}>OFICINA</text>`
  floors.forEach((p, i) => {
    const y = top + i * fh
    const working = count(p, 'trabajando')
    const waiting = count(p, 'espera')
    const today = count(p, 'hoy')
    s += `<rect x="${bx}" y="${y}" width="${bw}" height="${fh - 1}" fill="${i % 2 ? '#4c1d95' : '#5b21b6'}"><title>${xml(p.name)}</title></rect>`
    for (let k = 0; k < 6; k++) {
      const lit = k < working ? '#4ade80' : k < working + waiting ? '#fb923c' : k < working + waiting + Math.min(today, 2) ? '#fde68a' : '#2e1065'
      s += `<rect class="${lit === '#4ade80' ? 'lit' : ''}" x="${bx + 5 + k * 16.5}" y="${y + 3}" width="10" height="${fh - 7}" rx="1.5" fill="${lit}"/>`
    }
  })
  const stat = (x: number, num: number, label: string, color: string) =>
    `<text x="${x}" y="78" font-size="26" font-weight="800" fill="${color}" ${FONT}>${num}</text><text x="${x}" y="93" font-size="9.5" fill="#ede9fe" ${FONT}>${label}</text>`
  s += `<text x="146" y="30" font-size="16" font-weight="800" fill="#fff" ${FONT}>Tu oficina</text>`
  s += `<text x="146" y="45" font-size="9.5" fill="#ddd6fe" ${FONT}>${d.projects.length} proyectos · ${all.length} hilos · cada piso, un proyecto</text>`
  s += stat(146, n('trabajando'), 'trabajando', '#86efac')
  s += stat(216, n('espera'), 'te esperan', '#fdba74')
  s += stat(286, n('hoy'), 'activos hoy', '#93c5fd')
  return s + '</svg>'
}

function ringSvg(pct: number | null, color: string, size: number): string {
  const r = 15
  const c = 2 * Math.PI * r
  const label = pct === null ? '—' : `${pct}%`
  const arc = pct === null ? 0 : (c * pct) / 100
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}">
<circle cx="20" cy="20" r="${r}" fill="none" stroke="#9ca3af" stroke-opacity=".3" stroke-width="5"/>
${arc > 0 ? `<circle cx="20" cy="20" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${arc} ${c}" transform="rotate(-90 20 20)"/>` : ''}
<text x="20" y="23.5" text-anchor="middle" font-size="${pct === 100 ? 8.5 : 10}" font-weight="800" fill="${pct === null ? '#9ca3af' : color}" ${FONT}>${label}</text></svg>`
}

/* ------------------------------------------------------------------ */
/* Registro                                                             */
/* ------------------------------------------------------------------ */

let timer: { cancel: () => void } | null = null

/* ------------------------------------------------------------------ */
/* Puente con el juego (ventana aparte servida por server.js)          */
/* ------------------------------------------------------------------ */

const GAME_URL = 'http://localhost:4317/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const SESSION_RE = /^local_[0-9a-f-]{36}$/i

type QueueItem = {
  id: string
  created: string
  type: 'send' | 'open' | 'archive' | 'broadcast' | 'create' | 'speak' | 'transcribe'
  title?: string
  sessionId?: string
  link?: string
  message?: string
  project?: string
  cwd?: string
  targets?: { sessionId: string; title: string }[]
  /** speak: la frase (máximo 400 letras), la voz de ElevenLabs, el modelo y el nombre del mp3 (hash). */
  text?: string
  voiceId?: string
  model?: string
  audio?: string
  /** transcribe: el archivo en data/uploads y su idioma. */
  upload?: string
  language?: string
}
/** `audio`: el hash del mp3 guardado en data/audio (speak); `text`: lo transcrito (transcribe). */
type OrderResult = { status: 'sent' | 'relayed' | 'done' | 'error'; detail: string; audio?: string; text?: string }
const ok = (detail: string): OrderResult => ({ status: 'done', detail })
const fail = (detail: string): OrderResult => ({ status: 'error', detail: cut(detail, 240) })

/* ---- Voces premium (ElevenLabs) ---- */
const VOICE_RE = /^[A-Za-z0-9]{10,40}$/
const AUDIO_RE = /^[a-f0-9]{32}$/
const UPLOAD_RE = /^[a-z0-9-]{8,40}\.(webm|ogg|m4a|mp3|wav)$/
const VOICE_MODELS = ['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_multilingual_v2', 'eleven_v3', 'eleven_v4']
const SPEAK_MAX = 400
/** Una generación en curso, guardada en data/audio/<hash>.pending.json para no pagarla dos veces si el panel se recarga. */
type SpeakPending = { order: string; flowId: string; sessionIds: string[]; status: string; started: number }

/** Lee el JSON que devuelve una herramienta del conector (a veces con texto alrededor). Puro, sin $. */
function parseToolJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  try { return JSON.parse(text) as Record<string, unknown> } catch { /* sigue */ }
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) as Record<string, unknown> } catch { return null }
}

/**
 * Busca el enlace del audio generado dentro de la respuesta de creative_get_flow_run_status.
 * Hoy llega en `generations[].content_url` (https firmado a un .mp3 en elevenlabsusercontent.com, caduca
 * en unas horas); si cambia, recorre la respuesta, descarta el lienzo (elevenlabs.io/app/...) y prefiere
 * claves con nombre de audio. Puro, sin $.
 */
function findAudioUrl(answer: unknown): string | null {
  const gens = (answer as { generations?: { content_url?: unknown; status?: unknown }[] } | null)?.generations
  const direct = Array.isArray(gens) ? gens.find(g => g && g.status !== 'failed' && typeof g.content_url === 'string' && g.content_url.startsWith('https://')) : undefined
  if (direct) return direct.content_url as string
  const found: { key: string; url: string }[] = []
  const walk = (v: unknown, key: string, depth: number) => {
    if (depth > 8 || v === null || v === undefined) return
    if (typeof v === 'string') {
      if (/^https:\/\/\S+$/.test(v) && !/\/app\//.test(v) && !/orb|thumbnail|\.webp|\.png|\.jpe?g/i.test(v)) found.push({ key, url: v })
      return
    }
    if (Array.isArray(v)) { v.forEach(x => walk(x, key, depth + 1)); return }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k, depth + 1)
  }
  walk(answer, '', 0)
  const score = (f: { key: string; url: string }) =>
    (/content|master|audio|output|full_res|download|media|file|signed/i.test(f.key) ? 2 : 0) + (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(f.url) ? 1 : 0) - (/words_download/i.test(f.key) ? 5 : 0)
  found.sort((a, b) => score(b) - score(a))
  return found[0]?.url ?? null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'oficina', description: 'Abre la oficina virtual de tus proyectos e hilos' })
    await $.tool.register({
      name: 'resumen',
      description:
        'Resumen en vivo de la oficina de proyectos de la persona: cada proyecto con sus hilos de Claude Code, su estado (trabajando, te espera, activo hoy, esta semana, dormido), el avance de su lista de tareas, el paso en curso o la pregunta pendiente, y el session_id para enviarle mensajes. Úsala cuando pregunte cómo van sus proyectos o hilos.',
      inputSchema: {
        type: 'object',
        properties: { proyecto: { type: 'string', description: 'Opcional: parte del nombre de un proyecto para ver solo ese.' } },
      },
    })
    void $.ui.open({ id: PANE, title: TITLE })

    // Un solo ciclo de actualización: cada 15 s, o enseguida cuando el panel lo pide.
    let last = 0
    let running = false
    let seenReq = -1
    const tick = async () => {
      if (running) return
      const req = await read($, reqA)
      if (req === seenReq && Date.now() - last < REFRESH_MS) return
      running = true
      seenReq = req
      last = Date.now()
      await update($, busyA, () => true)
      try {
        const run = await $.process.run(['node', `${$.plugin.root}/scripts/collect.cjs`], { timeoutMs: 180000 })
        if (run.exitCode !== 0) throw new Error(run.stderr || `collect salió con código ${run.exitCode}`)
        let live: ToolAnswer = null
        try {
          live = (await $.tool.call({ tool: 'mcp__ccd_session_mgmt__list_sessions', limit: 200 } as never)) as ToolAnswer
        } catch { /* sin datos en vivo: se usa la hora de actividad */ }
        const fresh = buildData(run.stdout, live)
        await update($, dataA, () => fresh)
      } catch (err) {
        const msg = String((err as Error)?.message ?? err).slice(0, 300)
        await update($, dataA, prev => ({
          generated: prev?.generated ?? new Date().toISOString(),
          isLive: false,
          error: msg,
          projects: prev?.projects ?? [],
        }))
      } finally {
        running = false
        await update($, busyA, () => false)
      }
    }
    /* ---- Puente: el juego deja órdenes en data/queue y aquí se ejecutan ---- */
    const gameDir = String(e.cwd ?? '').replace(/[\\/]+$/, '')
    const hasGame = gameDir ? await $.fs.exists(`${gameDir}/server.js`).catch(() => false) : false
    const relay = async (text: string) => { await $.prompt.submit({ text: `Desde la oficina (juego): ${text}` }) }
    const call = async (input: Record<string, unknown>) => (await $.tool.call(input as never)) as ToolAnswer

    /* ---- Voces premium: el conector de ElevenLabs que esta sesión tenga conectado ---- */
    let vozTools: { gen: string; status: string } | null = null
    let vozLooked = 0
    const findVozTools = async () => {
      if (vozTools || Date.now() - vozLooked < 60e3) return vozTools
      vozLooked = Date.now()
      const list = await $.tool.list().catch(() => [])
      const voiceOnly = (d: string) => (/covers voice and speech/i.test(d) ? 1 : 0)
      const gens = list.filter(t => t.mcp && t.name.endsWith('__creative_generate_speech'))
        .sort((x, y) => voiceOnly(y.description) - voiceOnly(x.description))
      for (const g of gens) {
        const status = `${g.name.slice(0, -'creative_generate_speech'.length)}creative_get_flow_run_status`
        if (list.some(t => t.name === status)) { vozTools = { gen: g.name, status }; break }
      }
      return vozTools
    }

    /**
     * Orden speak, por pasos (una vuelta del puente cada segundo): 1) si el mp3 ya existe, listo;
     * 2) si no hay generación en curso, la empieza (gasta créditos) y la anota en <hash>.pending.json;
     * 3) si la hay, pregunta su estado y, al terminar, baja el audio a data/audio/<hash>.mp3.
     * Devuelve null mientras ElevenLabs sigue trabajando.
     */
    const runSpeak = async (a: QueueItem): Promise<OrderResult | null> => {
      if (!a.text || a.text.length > SPEAK_MAX || !a.voiceId || !VOICE_RE.test(a.voiceId) || !a.audio || !AUDIO_RE.test(a.audio)) {
        return fail('Orden de voz incompleta.')
      }
      const mp3 = `${gameDir}/data/audio/${a.audio}.mp3`
      const pendingPath = `${gameDir}/data/audio/${a.audio}.pending.json`
      if (await $.fs.exists(mp3).catch(() => false)) return { status: 'done', detail: 'Voz lista.', audio: a.audio }
      let p: SpeakPending | null = null
      try { p = JSON.parse(await $.fs.read(pendingPath)) as SpeakPending } catch { p = null }
      const validStatus = (s: unknown) => typeof s === 'string' && /^mcp__[\w-]+__creative_get_flow_run_status$/.test(s)
      if (p && (typeof p.flowId !== 'string' || !Array.isArray(p.sessionIds) || !validStatus(p.status) || Date.now() - p.started > 3 * 60e3)) p = null

      if (!p) {
        if (Date.now() - new Date(a.created).getTime() > 10 * 60e3) return fail('La orden venció: se dio hace más de 10 minutos.')
        const tools = await findVozTools()
        if (!tools) return fail('No encontré el conector de voz de ElevenLabs en esta sesión de Claude.')
        const model = a.model && VOICE_MODELS.includes(a.model) ? a.model : 'eleven_flash_v2_5'
        const r = await call({
          tool: tools.gen, prompt: a.text, voice_id: a.voiceId, model_id: model, generations_count: 1,
          context: 'Voz de un personaje del juego Oficina de chats; la persona encendió las voces premium.',
        })
        if (r?.deny) return fail(`Falta permiso para ElevenLabs: permite ${tools.gen} y ${tools.status} (mira el README).`)
        if (!r || r.isError) return fail(`ElevenLabs: ${r?.text ?? 'no respondió.'}`)
        const j = parseToolJson(r.text)
        const flowId = typeof j?.flow_id === 'string' ? j.flow_id : ''
        const raw = Array.isArray(j?.session_ids) ? j.session_ids : typeof j?.session_id === 'string' ? [j.session_id] : []
        const sessionIds = raw.filter((x): x is string => typeof x === 'string').slice(0, 4)
        if (!flowId || !sessionIds.length) return fail('ElevenLabs no devolvió la generación.')
        await $.fs.write(pendingPath, JSON.stringify({ order: a.id, flowId, sessionIds, status: tools.status, started: Date.now() } satisfies SpeakPending))
        return null
      }

      const r = await call({ tool: p.status, flow_id: p.flowId, session_ids: p.sessionIds, context: 'Revisar si ya está lista la voz del personaje.' })
      if (r?.deny) return fail(`Falta permiso para ElevenLabs: permite ${p.status} (mira el README).`)
      const j = r && !r.isError ? parseToolJson(r.text) : null
      if (j?.has_failures) return fail(`ElevenLabs no pudo generar la voz. ${cut(String(j.error ?? j.message ?? ''), 160)}`.trim())
      if (!j?.all_completed) return Date.now() - p.started > 120e3 ? fail('ElevenLabs tardó demasiado con la voz.') : null
      const url = findAudioUrl(j)
      if (!url) return fail('ElevenLabs terminó, pero no encontré el enlace del audio.')
      const run = await $.process.run(['node', `${$.plugin.root}/scripts/bajar-audio.cjs`, url, mp3], { timeoutMs: 60000 })
      if (run.exitCode !== 0) return fail(`No pude guardar el audio: ${run.stderr || run.stdout}`)
      return { status: 'done', detail: 'Voz lista.', audio: a.audio }
    }

    const runOrder = async (a: QueueItem): Promise<OrderResult | null> => {
      try {
        if (a.type === 'speak') return await runSpeak(a)
        if (Date.now() - new Date(a.created).getTime() > 10 * 60e3) return fail('La orden venció: se dio hace más de 10 minutos.')
        if (a.type === 'transcribe') {
          if (!a.upload || !UPLOAD_RE.test(a.upload) || !(await $.fs.exists(`${gameDir}/data/uploads/${a.upload}`).catch(() => false))) {
            return fail('No encontré la grabación.')
          }
          // El conector de ElevenLabs solo transcribe audio que ya esté en un flujo: un enlace https público,
          // un archivo adjunto al chat o uno que la persona elige a mano en su selector. Una grabación del PC
          // no llega sola, así que por ahora se responde «no disponible» (el juego esconde el botón).
          return fail('La transcripción premium todavía no está disponible: el conector de ElevenLabs no recibe grabaciones del PC.')
        }
        if (a.type === 'send') {
          if (!a.sessionId || !SESSION_RE.test(a.sessionId) || !a.message) return fail('Orden incompleta.')
          const r = await call({ tool: 'mcp__ccd_session_mgmt__send_message', session_id: a.sessionId, message: a.message })
          if (r?.deny) {
            await relay(`envía esta instrucción al hilo «${a.title}» (session_id ${a.sessionId}) con send_message, tal cual, sin cambiarla:\n\n${a.message}`)
            return { status: 'relayed', detail: 'Se la pasé a Claude en el chat para que la entregue.' }
          }
          if (r?.isError && /no sign of starting|can still/i.test(r.text ?? '')) {
            return { status: 'sent', detail: 'Enviada, pero el hilo todavía no la toma (puede estar esperando una aprobación allá).' }
          }
          if (!r || r.isError) return fail(r?.text ?? 'No se pudo enviar.')
          return { status: 'sent', detail: /delivery:\s*queued/.test(r.text ?? '') ? 'En cola: el hilo la toma al terminar lo que está haciendo.' : 'Entregada: el hilo ya está trabajando en ella.' }
        }
        if (a.type === 'broadcast') {
          const targets = (a.targets ?? []).filter(t => SESSION_RE.test(t.sessionId))
          let sent = 0
          for (const t of targets) {
            const r = await call({ tool: 'mcp__ccd_session_mgmt__send_message', session_id: t.sessionId, message: a.message ?? '' })
            if (r?.deny) {
              await relay(`pide a cada uno de estos hilos un resumen corto de su avance (send_message): ${targets.map(x => `«${x.title}» (${x.sessionId})`).join(', ')}.`)
              return { status: 'relayed', detail: 'Se lo pasé a Claude en el chat para que pregunte a cada hilo.' }
            }
            if (r && !r.isError) sent++
          }
          return sent ? { status: 'sent', detail: `Le pedí avance a ${sent} de ${targets.length} hilos. Sus respuestas quedan en cada hilo.` } : fail('No pude preguntarle a ningún hilo.')
        }
        if (a.type === 'create') {
          if (!a.cwd || !a.message || !(await $.fs.exists(a.cwd).catch(() => false))) return fail('La carpeta del proyecto no existe.')
          const background = `Hilo creado desde la oficina (juego) para el proyecto «${a.project}», en la carpeta ${a.cwd}. La persona escribió esta tarea tal cual y espera que se trabaje en esa carpeta: ${a.message}`
          const r = await call({ tool: 'mcp__ccd_session__start_session', initiation: 'user_asked', context: 'fresh', title: cut(a.message, 58), prompt: a.message, background, cwd: a.cwd })
          if (r?.deny) {
            await relay(`crea un hilo nuevo (start_session, user_asked) en la carpeta ${a.cwd} con esta tarea, tal cual: ${a.message}`)
            return { status: 'relayed', detail: 'Se lo pasé a Claude en el chat para que cree el hilo.' }
          }
          if (!r || r.isError) return fail(r?.text ?? 'No se pudo crear el hilo.')
          return { status: 'sent', detail: 'Hilo creado: en unos segundos aparece un trabajador nuevo en la oficina.' }
        }
        if (a.type === 'archive') {
          if (!a.sessionId || !SESSION_RE.test(a.sessionId)) return fail('Orden incompleta.')
          const r = await call({ tool: 'mcp__ccd_session_mgmt__archive_session', session_id: a.sessionId, reason: 'Archivado desde la oficina (juego)' })
          if (r?.deny) {
            await relay(`archiva el hilo «${a.title}» (session_id ${a.sessionId}) con archive_session.`)
            return { status: 'relayed', detail: 'Se lo pasé a Claude en el chat para que lo archive.' }
          }
          if (!r || r.isError) return fail(r?.text ?? 'No se pudo archivar.')
          return ok('Hilo archivado. Puedes recuperarlo desde Archivados en la barra lateral de Claude.')
        }
        if (a.type === 'open') {
          if (!a.link || !a.link.startsWith('claude://')) return fail('Ese hilo no tiene enlace para abrirlo.')
          await $.process.run(['rundll32', 'url.dll,FileProtocolHandler', a.link], { timeoutMs: 15000 })
          return ok('Abriendo el hilo en Claude.')
        }
        return fail('Orden desconocida.')
      } catch (err) {
        return fail(String((err as Error)?.message ?? err))
      }
    }

    let lastLive = 0
    let bridging = false
    const bridge = async () => {
      if (!hasGame || bridging) return
      bridging = true
      try {
        if (Date.now() - lastLive > 5000) {
          lastLive = Date.now()
          const r = await call({ tool: 'mcp__ccd_session_mgmt__list_sessions', limit: 200 }).catch(() => null)
          const m = r && !r.deny && !r.isError && r.text ? r.text.match(/\[[\s\S]*\]/) : null
          if (m) {
            try {
              await $.fs.write(`${gameDir}/data/live.json`, JSON.stringify({ updated: new Date().toISOString(), sessions: JSON.parse(m[0]) }))
            } catch { /* se intenta en la próxima vuelta */ }
          }
        }
        const entries = await $.fs.list(`${gameDir}/data/queue`).catch(() => [])
        for (const ent of entries) {
          if (!ent.name.endsWith('.json')) continue
          const id = ent.name.slice(0, -5)
          if (!/^[a-z0-9-]+$/i.test(id)) continue
          const donePath = `${gameDir}/data/done/${id}.json`
          if (await $.fs.exists(donePath).catch(() => true)) continue
          let item: QueueItem
          try { item = JSON.parse(await $.fs.read(`${gameDir}/data/queue/${ent.name}`)) as QueueItem } catch { continue }
          const result = await runOrder(item)
          if (!result) continue // sigue en curso (voz premium): se revisa en la próxima vuelta
          await $.fs.write(donePath, JSON.stringify({ id, ...result, finished: new Date().toISOString() }))
          askLater = true
        }
      } finally {
        bridging = false
      }
    }
    let askLater = false

    if (timer) timer.cancel()
    timer = $.clock.every(1000, () => {
      void tick()
      void bridge()
      if (askLater) { askLater = false; void update($, reqA, n => n + 1) }
    })
    void tick()

    const started = await next(e)
    if (hasGame) {
      // El servidor del juego vive mientras viva este panel (si ya hay uno abierto, el nuevo se cierra solo).
      void (async () => {
        const srv = $.process.spawn({ argv: ['node', 'server.js'], cwd: gameDir })
        for await (const piece of srv) { void piece }
      })()
    }
    return started
  })

  on('command.run', { command: 'oficina' }, async $ => {
    await update($, viewA, () => ({ screen: 'home' }) as OficinaView)
    await update($, reqA, n => n + 1)
    await $.ui.open({ id: PANE, title: TITLE })
    const opened = await $.process.run([EDGE, `--app=${GAME_URL}`, '--window-size=1280,860'], { timeoutMs: 20000 }).catch(() => null)
    return { text: opened ? 'Abrí la oficina (juego) en su propia ventana.' : `No pude abrir la ventana del juego; ábrelo en ${GAME_URL}` }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { proyecto?: string }
    const d = await read($, dataA)
    const text = summaryText(d, typeof input.proyecto === 'string' && input.proyecto.trim() ? input.proyecto.trim() : undefined)
    return { result: text }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const Input = 'Input' in ui ? ui.Input : undefined

    const data = await read($, dataA)
    const view = await read($, viewA)
    const send = await read($, sendA)
    const showSleeping = await read($, sleepA)
    const busy = await read($, busyA)
    const pins = await read($, pinsA)
    const uiState = await read($, uiA)

    /* ---------- Acciones ---------- */
    const askRefresh = () => { void update($, reqA, n => n + 1) }
    const go = (v: OficinaView) => () => {
      void update($, uiA, s => ({ ...s, confirm: null, composing: null, notice: null }))
      void update($, viewA, () => v)
    }
    const setUi = (fn: (s: OficinaUi) => OficinaUi) => update($, uiA, fn)
    const notify = (text: string, tone: 'ok' | 'error' | 'info') => setUi(s => ({ ...s, notice: { text, tone } }))
    const setSend = (fn: (s: OficinaSend) => OficinaSend) => update($, sendA, fn)
    const callTool = async (input: Record<string, unknown>) => (await $.tool.call(input as never)) as ToolAnswer
    const relay = async (text: string) => { await $.prompt.submit({ text: `Desde el panel Oficina: ${text}` }) }

    const sendTo = async (t: OficinaThread, text: string) => {
      const message = text.trim()
      if (!message) return
      await setSend(s => ({ count: s.count, threadId: t.id, status: 'sending', detail: message }))
      if (!t.sessionId) {
        await setSend(s => ({ ...s, status: 'error', detail: 'Este hilo no está abierto en la app (archivado o de la terminal).' }))
        return
      }
      try {
        const r = await callTool({ tool: 'mcp__ccd_session_mgmt__send_message', session_id: t.sessionId, message })
        if (r?.deny) {
          await relay(`envía esta instrucción al hilo «${t.title}» (session_id ${t.sessionId}) con send_message, tal cual, sin cambiarla:\n\n${message}`)
          await setSend(s => ({ count: s.count + 1, threadId: t.id, status: 'relayed', detail: 'Se la pasé a Claude en el chat para que la entregue.' }))
          return
        }
        if (!r || r.isError) throw new Error(r?.text ?? 'no se pudo enviar')
        const queued = /delivery:\s*queued/.test(r.text ?? '')
        await setSend(s => ({
          count: s.count + 1, threadId: t.id, status: 'sent',
          detail: queued ? 'En cola: el hilo la toma al terminar lo que está haciendo.' : 'Entregada: el hilo ya está trabajando en ella.',
        }))
        $.ui.toast(`Instrucción enviada a «${cut(t.title, 40)}»`)
        askRefresh()
      } catch (err) {
        const msg = String((err as Error)?.message ?? err).slice(0, 300)
        await setSend(s => ({ ...s, status: 'error', detail: msg }))
      }
    }

    const broadcast = async (p: OficinaProject) => {
      const targets = p.threads.filter(t => t.sessionId && (t.status === 'hoy' || t.status === 'semana' || t.status === 'espera'))
      const message = 'Dame un resumen corto de cómo vas: qué está hecho, qué falta y si algo te bloquea.'
      await setUi(s => ({ ...s, confirm: null, notice: { text: `Pidiendo avance a ${targets.length} hilos…`, tone: 'info' } }))
      let ok = 0
      let relayed = false
      for (const t of targets) {
        try {
          const r = await callTool({ tool: 'mcp__ccd_session_mgmt__send_message', session_id: t.sessionId, message })
          if (r?.deny) { relayed = true; break }
          if (r && !r.isError) ok++
        } catch { /* sigue con el próximo */ }
      }
      if (relayed) {
        await relay(`pide a cada uno de estos hilos un resumen corto de su avance (send_message): ${targets.map(t => `«${t.title}» (${t.sessionId})`).join(', ')}.`)
        await notify('Se lo pasé a Claude en el chat para que lo envíe a cada hilo.', 'info')
      } else {
        await notify(`Listo: le pedí avance a ${ok} de ${targets.length} hilos. Sus respuestas llegan a cada hilo.`, ok ? 'ok' : 'error')
      }
      askRefresh()
    }

    const createThread = async (p: OficinaProject, text: string) => {
      const task = text.trim()
      if (!task || !p.path) return
      await setUi(s => ({ ...s, composing: null, notice: { text: 'Creando el hilo…', tone: 'info' } }))
      const background = `Hilo creado desde el panel Oficina para el proyecto «${p.name}», en la carpeta ${p.path}. La persona escribió esta tarea tal cual y espera que se trabaje en esa carpeta: ${task}`
      try {
        const r = await callTool({
          tool: 'mcp__ccd_session__start_session', initiation: 'user_asked', context: 'fresh',
          title: cut(task, 58), prompt: task, background, cwd: p.path,
        })
        if (r?.deny) {
          await relay(`crea un hilo nuevo (start_session, user_asked) en la carpeta ${p.path} con esta tarea, tal cual: ${task}`)
          await notify('Se lo pasé a Claude en el chat para que cree el hilo.', 'info')
        } else if (!r || r.isError) {
          throw new Error(r?.text ?? 'no se pudo crear')
        } else {
          await notify('Hilo creado. Aparecerá en esta oficina en unos segundos.', 'ok')
        }
      } catch (err) {
        await notify(`No pude crear el hilo: ${String((err as Error)?.message ?? err).slice(0, 200)}`, 'error')
      }
      askRefresh()
    }

    const archive = async (t: OficinaThread) => {
      if (!t.sessionId) return
      await setUi(s => ({ ...s, confirm: null, notice: { text: 'Archivando…', tone: 'info' } }))
      try {
        const r = await callTool({ tool: 'mcp__ccd_session_mgmt__archive_session', session_id: t.sessionId, reason: 'Archivado desde el panel Oficina' })
        if (r?.deny) {
          await relay(`archiva el hilo «${t.title}» (session_id ${t.sessionId}) con archive_session.`)
          await notify('Se lo pasé a Claude en el chat para que lo archive.', 'info')
        } else if (!r || r.isError) {
          throw new Error(r?.text ?? 'no se pudo archivar')
        } else {
          await notify('Hilo archivado. Puedes recuperarlo desde Archivados en la barra lateral.', 'ok')
        }
      } catch (err) {
        await notify(`No pude archivarlo: ${String((err as Error)?.message ?? err).slice(0, 200)}`, 'error')
      }
      askRefresh()
    }

    const openThread = async (t: OficinaThread) => {
      if (!t.link) return
      try {
        await $.process.run(['rundll32', 'url.dll,FileProtocolHandler', t.link], { timeoutMs: 15000 })
      } catch (err) {
        await notify(`No pude abrirlo: ${String((err as Error)?.message ?? err).slice(0, 200)}`, 'error')
      }
    }

    const launchGame = async () => {
      const r = await $.process.run([EDGE, `--app=${GAME_URL}`, '--window-size=1280,860'], { timeoutMs: 20000 }).catch(() => null)
      if (!r) await notify(`No pude abrir la ventana del juego. Ábrelo en ${GAME_URL}`, 'error')
    }

    const togglePin = (key: string) => () => {
      void update($, pinsA, list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))
    }

    /* ---------- Piezas visuales ---------- */
    const pic = (source: string, alt: string, interactive?: boolean) =>
      Svg ? (interactive ? <Svg source={source} alt={alt} isInteractive /> : <Svg source={source} alt={alt} />) : null
    const ring = (pct: number | null, color: string, size: number, alt: string) =>
      Svg ? <Svg source={ringSvg(pct, color, size)} alt={alt} width={size} height={size} /> : <Text bold color={color}>{pct === null ? '—' : `${pct}%`}</Text>
    const noticeLine = uiState.notice ? (
      <Text size="footnote" color={uiState.notice.tone === 'error' ? 'error' : uiState.notice.tone === 'ok' ? 'success' : 'suggestion'}>
        {uiState.notice.tone === 'error' ? '⚠️ ' : uiState.notice.tone === 'ok' ? '✓ ' : 'ℹ️ '}{uiState.notice.text}
      </Text>
    ) : null

    /** Una fila por hilo: anillo de avance, título (se pulsa para abrir) y una línea de estado. */
    const threadRow = (t: OficinaThread, p: OficinaProject, showProject: boolean) => {
      const st = STATUS[t.status]
      const pr = progressOf(t)
      return (
        <Box key={`row-${t.id}`} flexDirection="row" gap={1} alignItems="center">
          {ring(pr ? pr.pct : null, st.color, 40, pr ? `${pr.done} de ${pr.total} pasos` : 'sin lista de tareas')}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Button key={`open-${t.id}`} plain onPress={go({ screen: 'thread', key: p.key, id: t.id })}>
              {st.emoji} {cut(t.title, 60)}
            </Button>
            <Text size="footnote" color={t.status === 'espera' ? 'warning' : undefined} dimColor={t.status !== 'espera'} wrap="truncate-end">
              {showProject ? `${p.name} · ` : ''}{st.short} · {ago(t.updated)} · {cut(oneLiner(t), 140)}
            </Text>
          </Box>
        </Box>
      )
    }

    if (!data) {
      return (
        <Box flexDirection="column" gap={1} padding={1}>
          <Text size="heading" weight="bold">🏢 Abriendo la oficina…</Text>
          <Text dimColor>Estoy leyendo tus hilos de Claude. La primera vez tarda unos segundos.</Text>
        </Box>
      )
    }
    const projects = sortProjects(data.projects, pins)

    /* ---------- Hilo ---------- */
    if (view.screen === 'thread') {
      const p = data.projects.find(x => x.key === view.key)
      const t = p?.threads.find(x => x.id === view.id)
      if (!p || !t) {
        return (
          <Box flexDirection="column" gap={1} padding={1}>
            <Button key="back" plain label="← Oficinas" onPress={go({ screen: 'home' })} />
            <Text dimColor>Ese hilo ya no aparece (quizá se archivó).</Text>
          </Box>
        )
      }
      const st = STATUS[t.status]
      const pr = progressOf(t)
      const mine = send.threadId === t.id ? send : null
      const quick = [
        { k: 'q-go', label: '▶ Continúa', text: 'Continúa con el siguiente paso de tu lista.' },
        { k: 'q-yes', label: '✅ Sí, hazlo', text: 'Sí, hazlo.' },
        { k: 'q-how', label: '📋 ¿Cómo vas?', text: 'Dame un resumen corto de cómo vas: qué está hecho, qué falta y si algo te bloquea.' },
      ]
      const confirmingArchive = uiState.confirm === `archive:${t.id}`
      return (
        <Box flexDirection="column" gap={1} padding={1}>
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Button key="back-home" plain label="← Oficinas" onPress={go({ screen: 'home' })} />
            <Button key="back-proj" plain label={`← ${p.name}`} onPress={go({ screen: 'project', key: p.key })} />
          </Box>

          <Box flexDirection="row" gap={2} alignItems="center">
            {ring(pr ? pr.pct : null, st.color, 64, pr ? `${pr.pct}% hecho` : 'sin lista')}
            <Box flexDirection="column" flexShrink={1}>
              <Text size="heading" weight="bold">{t.title}</Text>
              <Text color={st.theme}>{st.emoji} {st.label} · {ago(t.updated)}</Text>
              <Text size="footnote" dimColor>{pr ? `${pr.done} de ${pr.total} pasos` : 'Sin lista de tareas'}{t.worktree ? ` · 🌿 ${cut(t.worktree, 30)}` : ''}</Text>
            </Box>
          </Box>

          {t.ask ? (
            <Box flexDirection="column" gap={1} padding={1} borderStyle="round" borderColor="warning">
              <Text weight="semibold" color="warning">🔔 Te pregunta</Text>
              <Text>{t.ask}</Text>
            </Box>
          ) : null}

          <Box flexDirection="column" gap={1} padding={1} borderStyle="round" borderColor="claude">
            <Text weight="semibold">💬 Dile qué hacer</Text>
            {t.sessionId ? (
              <Box flexDirection="column" gap={1}>
                <Box flexDirection="row" gap={1} flexWrap="wrap">
                  {quick.map(q => <Button key={q.k} label={q.label} onPress={() => { void sendTo(t, q.text) }} />)}
                </Box>
                {Input ? (
                  <Input
                    key={`instr-${t.id}-${send.count}`}
                    placeholder="O escribe tu instrucción…"
                    rows={2}
                    submitLabel="Enviar"
                    onSubmit={(value: string) => { void sendTo(t, value) }}
                  />
                ) : null}
              </Box>
            ) : (
              <Text size="footnote" dimColor>
                {p.name === 'oficina de chats' ? 'Este es el chat donde estás ahora: escríbele directamente.' : 'Este hilo no está abierto en la app (archivado o de terminal), así que no puedo enviarle mensajes.'}
              </Text>
            )}
            {mine && mine.status !== 'idle' ? (
              <Text size="footnote" color={mine.status === 'error' ? 'error' : mine.status === 'sending' ? undefined : 'success'}>
                {mine.status === 'sending' ? '⏳ Enviando…' : mine.status === 'error' ? `⚠️ ${mine.detail}` : `✓ ${mine.detail}`}
              </Text>
            ) : null}
          </Box>

          {pr ? (
            <Box flexDirection="column">
              <Text weight="semibold">Pasos</Text>
              {(t.plan ?? []).map((s, i) => (
                <Text key={`step-${i}`} size="footnote" color={s.status === 'completed' ? 'success' : s.status === 'in_progress' ? 'claude' : undefined} dimColor={s.status === 'pending'} weight={s.status === 'in_progress' ? 'semibold' : undefined}>
                  {s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '▶' : '○'} {s.content}
                </Text>
              ))}
            </Box>
          ) : null}

          {t.recap ? (
            <Box flexDirection="column">
              <Text weight="semibold">Último resumen</Text>
              <Text size="footnote">{t.recap}</Text>
            </Box>
          ) : null}

          {t.sessionId ? (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {t.link ? <Button key="open-session" label="↗ Abrir hilo" onPress={() => { void openThread(t) }} /> : null}
              {confirmingArchive ? (
                <Box flexDirection="row" gap={1}>
                  <Button key="archive-yes" variant="primary" label="Sí, archivar" onPress={() => { void archive(t) }} />
                  <Button key="archive-no" plain label="Cancelar" onPress={() => { void setUi(s => ({ ...s, confirm: null })) }} />
                </Box>
              ) : (
                <Button key="archive" plain label="🗄 Archivar" onPress={() => { void setUi(s => ({ ...s, confirm: `archive:${t.id}` })) }} />
              )}
            </Box>
          ) : null}
          {noticeLine}
        </Box>
      )
    }

    /* ---------- Proyecto ---------- */
    if (view.screen === 'project') {
      const p = data.projects.find(x => x.key === view.key)
      if (!p) {
        return (
          <Box flexDirection="column" gap={1} padding={1}>
            <Button key="back" plain label="← Oficinas" onPress={go({ screen: 'home' })} />
            <Text dimColor>Esa oficina ya no aparece.</Text>
          </Box>
        )
      }
      const awake = p.threads.filter(t => t.status !== 'dormido')
      const sleeping = p.threads.filter(t => t.status === 'dormido')
      const pr = projectProgress(p)
      const reachable = p.threads.filter(t => t.sessionId && (t.status === 'hoy' || t.status === 'semana' || t.status === 'espera')).length
      const pinned = pins.includes(p.key)
      return (
        <Box flexDirection="column" gap={1} padding={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Button key="back" plain label="← Oficinas" onPress={go({ screen: 'home' })} />
            <Box flexDirection="row" gap={1}>
              <Button key="pin" plain label={pinned ? '⭐ Fijada' : '☆ Fijar'} onPress={togglePin(p.key)} />
              <Button key="refresh" plain label="↻" onPress={askRefresh} />
            </Box>
          </Box>
          <Box flexDirection="row" gap={2} alignItems="center">
            {ring(pr.total ? pr.pct : null, accentOf(p.key), 56, `${pr.pct}% de los pasos hechos`)}
            <Box flexDirection="column" flexShrink={1}>
              <Text size="heading" weight="bold">{p.name}</Text>
              <Text size="footnote" dimColor>
                {pr.total ? `${pr.done}/${pr.total} pasos` : 'Sin listas de tareas'} · {awake.length} activo{awake.length === 1 ? '' : 's'} · {ago(p.updated)}
              </Text>
            </Box>
          </Box>
          {pic(officeSvg(p, awake.length ? awake : p.threads.slice(0, 4)), `Oficina ${p.name}: un escritorio por hilo`, true)}

          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {p.path ? <Button key="new" variant="primary" label="➕ Nuevo hilo" onPress={() => { void setUi(s => ({ ...s, composing: s.composing === p.key ? null : p.key })) }} /> : null}
            {reachable ? (
              uiState.confirm === `broadcast:${p.key}` ? (
                <Box flexDirection="row" gap={1}>
                  <Button key="bc-yes" variant="primary" label={`Sí, preguntar a ${reachable}`} onPress={() => { void broadcast(p) }} />
                  <Button key="bc-no" plain label="Cancelar" onPress={() => { void setUi(s => ({ ...s, confirm: null })) }} />
                </Box>
              ) : (
                <Button key="bc" label="📣 Pedir avance a todos" onPress={() => { void setUi(s => ({ ...s, confirm: `broadcast:${p.key}` })) }} />
              )
            ) : null}
          </Box>
          {uiState.composing === p.key && Input ? (
            <Input
              key={`new-${p.key}`}
              label={`Nuevo hilo en ${p.name}`}
              placeholder="¿Qué quieres que haga? Ej: revisa los errores del formulario de registro"
              rows={3}
              submitLabel="Crear hilo"
              autoFocus
              onSubmit={(value: string) => { void createThread(p, value) }}
            />
          ) : null}
          {noticeLine}

          {awake.length ? awake.map(t => threadRow(t, p, false)) : <Text dimColor>Ningún hilo activo esta semana.</Text>}
          {sleeping.length ? (
            <Button key="toggle-sleep" plain label={showSleeping ? `Ocultar ${sleeping.length} dormidos` : `💤 Ver ${sleeping.length} hilos dormidos`} onPress={() => { void update($, sleepA, v => !v) }} />
          ) : null}
          {showSleeping ? sleeping.map(t => threadRow(t, p, false)) : null}
        </Box>
      )
    }

    /* ---------- Inicio ---------- */
    const waiting = projects.flatMap(p => p.threads.filter(t => t.status === 'espera').map(t => ({ t, p })))
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        {pic(bannerSvg(data, projects), `${data.projects.length} proyectos; ${waiting.length} hilos te esperan`)}
        <Button key="play" variant="primary" label="🎮 Entrar a la oficina (juego)" onPress={() => { void launchGame() }} />
        <Text size="footnote" dimColor>Camina por el edificio, entra a cada proyecto y revisa la bitácora de cada hilo.</Text>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text size="footnote" dimColor>
            {busy ? 'Actualizando…' : `Actualizado ${ago(data.generated)}`}{data.isLive ? ' · en vivo' : ''}
          </Text>
          <Button key="refresh" plain label="↻ Actualizar" onPress={askRefresh} />
        </Box>
        {data.error ? <Text color="error" size="footnote">No pude leer los hilos: {data.error}</Text> : null}
        {noticeLine}

        {waiting.length ? (
          <Box flexDirection="column" gap={1} padding={1} borderStyle="round" borderColor="warning">
            <Text weight="bold" color="warning">🔔 Te esperan ({waiting.length})</Text>
            {waiting.map(({ t, p }) => threadRow(t, p, true))}
          </Box>
        ) : (
          <Text size="footnote" color="success">✓ Ningún hilo está esperando tu respuesta.</Text>
        )}

        {projects.map(p => (
          <Box key={`proj-${p.key}`} flexDirection="column" gap={1}>
            {Svg ? pic(doorCardSvg(p, pins.includes(p.key)), `Oficina ${p.name}`) : <Text weight="bold">🏢 {p.name}</Text>}
            <Box flexDirection="row" gap={1}>
              <Button key={`enter-${p.key}`} variant="primary" label={`Entrar a ${cut(p.name, 24)} →`} onPress={go({ screen: 'project', key: p.key })} />
              <Button key={`pin-${p.key}`} plain label={pins.includes(p.key) ? '⭐' : '☆'} onPress={togglePin(p.key)} />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
