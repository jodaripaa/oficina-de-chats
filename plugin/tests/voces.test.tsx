import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Voces premium: el puente ejecuta las órdenes speak y transcribe que el juego deja en data/queue.
// El disco, los procesos y el conector de ElevenLabs se simulan aquí: nada gasta créditos.

const GAME = '/juego'
const HASH = 'ac7034da23a35f4e0f57a1ce0a1ad735'
const HASH2 = '0123456789abcdef0123456789abcdef'
const VOICE = '5Cv0Ai2PG63GLyPEHsNy'
const GEN = 'mcp__voz__creative_generate_speech'
const STATUS = 'mcp__voz__creative_get_flow_run_status'
const URL_MP3 = 'https://elevenlabsusercontent.com/database/x/content.mp3?Expires=1&Signature=abc'

type Call = { tool: string; [k: string]: unknown }
/** El motor entrega las rutas a su manera (en Windows, C:\juego\...): aquí se comparan como /juego/... */
const norm = (p: unknown) => String(p).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

function world(on: On, opts: { deny?: boolean; failAt?: number } = {}) {
  const files = new Map<string, string>([[`${GAME}/server.js`, '// juego']])
  const calls: Call[] = []
  const runs: string[][] = []
  let polls = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'oficina' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__oficina__resumen' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.spawn', async function* () { return { value: { code: 0, signal: null } } })
  on('fs.exists', (_, e) => {
    const p = norm(e.path)
    return { value: files.has(p) || [...files.keys()].some(k => k.startsWith(`${p}/`)) }
  })
  on('fs.read', (_, e) => {
    const v = files.get(norm(e.path))
    if (v === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: v }
  })
  on('fs.write', (_, e) => { files.set(norm(e.path), e.text); return { value: undefined } })
  on('fs.list', (_, e) => {
    const p = norm(e.path)
    return {
      value: [...files.keys()].filter(k => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/'))
        .map(k => ({ name: k.slice(p.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
    }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    if (String(argv[1]).endsWith('bajar-audio.cjs')) {
      files.set(norm(argv[3]), 'ID3…mp3')
      return { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 0, stdout: JSON.stringify({ generated: new Date().toISOString(), threads: [] }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.list', () => ({
    value: [
      { name: 'mcp__otro__creative_generate_speech', description: 'Generate speech from a text prompt.', mcp: true },
      { name: GEN, description: 'Generate speech. This connector covers voice and speech.', mcp: true },
      { name: STATUS, description: 'Check whether a run has finished.', mcp: true },
    ],
  }))
  on('tool.call', (_, e) => {
    const input = e as unknown as Call
    if (input.tool === 'mcp__ccd_session_mgmt__list_sessions') return { result: {}, text: '[]' }
    calls.push(input)
    if (input.tool === GEN) {
      if (opts.deny) return { deny: 'no hay regla que lo permita' }
      return { result: {}, text: JSON.stringify({ flow_id: 'f1', session_ids: ['s1'], pending: [{ generation_id: 'g1', kind: 'audio' }] }) }
    }
    if (input.tool === STATUS) {
      polls++
      if (opts.failAt === polls) return { result: {}, text: JSON.stringify({ all_completed: true, has_failures: true, error: 'sin créditos' }) }
      const done = polls >= 2
      return {
        result: {},
        text: JSON.stringify({
          flow_id: 'f1', url: 'https://elevenlabs.io/app/flows/f1',
          generations: [{ id: 'g1', status: done ? 'completed' : 'processing', ...(done ? { content_url: URL_MP3 } : {}) }],
          all_completed: done, has_failures: false,
        }),
      }
    }
    return { result: {}, text: 'ok' }
  })
  const order = (id: string, item: Record<string, unknown>) =>
    files.set(`${GAME}/data/queue/${id}.json`, JSON.stringify({ id, created: new Date().toISOString(), ...item }))
  const done = (id: string) => {
    const v = files.get(`${GAME}/data/done/${id}.json`)
    return v ? (JSON.parse(v) as { status: string; detail: string; audio?: string }) : null
  }
  return { files, calls, runs, order, done, gens: () => calls.filter(c => c.tool === GEN).length }
}

test('speak: genera una sola vez, espera, baja el mp3 y responde con su hash', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const w = world(on)
  w.order('o1', { type: 'speak', title: 'Recepción', text: '¡Hola! Ya terminé el carrito, ¿qué sigue?', voiceId: VOICE, model: 'eleven_flash_v2_5', audio: HASH })
  await $.session.start({ cwd: GAME, surface: 'desktop', isInteractive: true })

  for (let i = 0; i < 6 && !w.done('o1'); i++) await clock.advance(1000)

  const gen = w.calls.find(c => c.tool === GEN)
  expect(gen?.voice_id).toBe(VOICE)
  expect(gen?.model_id).toBe('eleven_flash_v2_5')
  expect(gen?.generations_count).toBe(1)
  expect(gen?.prompt).toBe('¡Hola! Ya terminé el carrito, ¿qué sigue?')
  expect(w.gens()).toBe(1) // nunca se paga dos veces mientras espera
  const bajada = w.runs.find(r => String(r[1]).endsWith('bajar-audio.cjs'))
  expect(bajada?.[2]).toBe(URL_MP3)
  expect(norm(bajada?.[3])).toBe(`${GAME}/data/audio/${HASH}.mp3`)
  expect(w.done('o1')).toMatchObject({ status: 'done', audio: HASH })

  // La misma frase otra vez: ya está guardada y no llama a ElevenLabs.
  w.order('o2', { type: 'speak', text: '¡Hola! Ya terminé el carrito, ¿qué sigue?', voiceId: VOICE, model: 'eleven_flash_v2_5', audio: HASH })
  await clock.advance(1000)
  await clock.advance(1000)
  expect(w.done('o2')).toMatchObject({ status: 'done', audio: HASH })
  expect(w.gens()).toBe(1)
})

test('speak: si el panel se recarga a mitad, retoma la generación en curso sin pagarla otra vez', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const w = world(on)
  w.files.set(`${GAME}/data/audio/${HASH2}.pending.json`, JSON.stringify({ order: 'o3', flowId: 'f1', sessionIds: ['s1'], status: STATUS, started: Date.now() }))
  w.order('o3', { type: 'speak', text: 'Hola', voiceId: VOICE, audio: HASH2 })
  await $.session.start({ cwd: GAME, surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 6 && !w.done('o3'); i++) await clock.advance(1000)
  expect(w.gens()).toBe(0)
  expect(w.done('o3')).toMatchObject({ status: 'done', audio: HASH2 })
})

test('speak: valida la orden y avisa los errores del conector', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const w = world(on, { failAt: 1 })
  w.order('bad1', { type: 'speak', text: 'Hola', voiceId: '../../x', audio: HASH })
  w.order('bad2', { type: 'speak', text: 'x'.repeat(401), voiceId: VOICE, audio: HASH })
  w.order('bad3', { type: 'speak', text: 'Hola', voiceId: VOICE, audio: '../../secreto' })
  w.order('old', { type: 'speak', text: 'Hola', voiceId: VOICE, audio: HASH, created: new Date(Date.now() - 11 * 60e3).toISOString() })
  w.order('o4', { type: 'speak', text: 'Hola de nuevo', voiceId: VOICE, audio: HASH2 })
  await $.session.start({ cwd: GAME, surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 6 && !w.done('o4'); i++) await clock.advance(1000)
  for (const id of ['bad1', 'bad2', 'bad3']) expect(w.done(id)).toMatchObject({ status: 'error', detail: 'Orden de voz incompleta.' })
  expect(w.done('old')?.detail).toMatch(/venció/)
  expect(w.done('o4')).toMatchObject({ status: 'error' })
  expect(w.done('o4')?.detail).toMatch(/no pudo generar la voz.*sin créditos/)
  expect(w.gens()).toBe(1)
  expect(w.files.has(`${GAME}/data/audio/${HASH2}.mp3`)).toBe(false)
})

test('speak: si Claude no deja usar el conector, lo dice sin reintentar', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const w = world(on, { deny: true })
  w.order('o5', { type: 'speak', text: 'Hola', voiceId: VOICE, audio: HASH })
  await $.session.start({ cwd: GAME, surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 4 && !w.done('o5'); i++) await clock.advance(1000)
  expect(w.done('o5')?.status).toBe('error')
  expect(w.done('o5')?.detail).toBe(`Falta permiso para ElevenLabs: permite ${GEN} y ${STATUS} (mira el README).`)
  expect(w.calls.filter(c => c.tool === STATUS)).toEqual([])
})

test('transcribe: revisa la grabación y responde que aún no está disponible', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const w = world(on)
  w.files.set(`${GAME}/data/uploads/mo0abc12-0123456789ab.webm`, 'webm')
  w.order('t1', { type: 'transcribe', upload: 'mo0abc12-0123456789ab.webm', language: 'es' })
  w.order('t2', { type: 'transcribe', upload: 'no-existe-000000.webm' })
  w.order('t3', { type: 'transcribe', upload: '../token.txt' })
  await $.session.start({ cwd: GAME, surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 3 && !w.done('t3'); i++) await clock.advance(1000)
  expect(w.done('t1')?.status).toBe('error')
  expect(w.done('t1')?.detail).toMatch(/todavía no está disponible/)
  expect(w.done('t2')?.detail).toBe('No encontré la grabación.')
  expect(w.done('t3')?.detail).toBe('No encontré la grabación.')
  expect(w.calls.filter(c => /creative_/.test(c.tool))).toEqual([])
})
