import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'oficina',
  component: 'Pane',
  requestId: 'oficina',
  props: {
    title: '🏢 Oficina',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const now = new Date().toISOString()
const COLLECT = JSON.stringify({
  generated: now,
  threads: [
    {
      id: 'a1', title: 'Rediseño de la tienda', first: 'hola', last: 'sigue', cwd: 'C:\\repo\\tienda', branch: 'main',
      created: now, updated: now, msgs: 3, recap: 'Terminé el carrito.', ask: null, closed: false,
      plan: [
        { content: 'Diseñar carrito', status: 'completed' },
        { content: 'Probar pagos', status: 'in_progress' },
        { content: 'Publicar', status: 'pending' },
      ],
      project: 'C:\\repo\\tienda', projectName: 'tienda', worktree: null,
    },
    {
      id: 'c3', title: 'Arreglar el menú', first: 'menú', last: 'ok', cwd: 'C:\\repo\\tienda', branch: null,
      created: now, updated: now, msgs: 2, recap: 'Menú listo.', ask: null, closed: true,
      plan: [{ content: 'Arreglar', status: 'completed' }],
      project: 'C:\\repo\\tienda', projectName: 'tienda', worktree: null,
    },
    {
      id: 'b2', title: 'Informe mensual', first: 'informe', last: 'ok', cwd: 'C:\\repo\\informes', branch: null,
      created: now, updated: now, msgs: 1, recap: 'Listo el borrador.', ask: '¿Lo envío al equipo?', closed: true,
      plan: [{ content: 'Redactar', status: 'completed' }],
      project: 'C:\\repo\\informes', projectName: 'informes', worktree: null,
    },
  ],
})
const LIVE = JSON.stringify([
  { sessionId: 'local_a1', title: 'Rediseño de la tienda', cwd: 'C:\\repo\\tienda', isRunning: true, lastActivityAt: now, link: 'claude://x/local_a1' },
  { sessionId: 'local_c3', title: 'Arreglar el menú', cwd: 'C:\\repo\\tienda', isRunning: false, lastActivityAt: now, link: 'claude://x/local_c3' },
  { sessionId: 'local_b2', title: 'Informe mensual', cwd: 'C:\\repo\\informes', isRunning: false, lastActivityAt: now, link: 'claude://x/local_b2' },
])

// El entorno de las pruebas tiene setTimeout, pero la lib de tipos (sin DOM ni Node) no lo declara.
declare const setTimeout: (fn: () => void, ms: number) => unknown
const settle = () => new Promise<void>(r => setTimeout(r, 30))

test('la oficina muestra proyectos, avance y maneja los hilos', async ($, on) => {
  const calls: { tool: string; [k: string]: unknown }[] = []
  on('command.register', () => ({ value: { command: 'oficina' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__oficina__resumen' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined })) // el temporizador no avanza: el ciclo corre una vez al empezar
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: COLLECT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', (_, e) => {
    const input = e as unknown as { tool: string; [k: string]: unknown }
    if (input.tool === 'mcp__ccd_session_mgmt__list_sessions') return { result: {}, text: LIVE }
    calls.push(input)
    return { result: {}, text: 'ok (delivery: delivered; message_id: m1)' }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 20; i++) await settle()

  // Portada en los dos tipos de superficie.
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Te esperan \(1\)/ })).toBeDefined()
    await ui.unmount()
  }

  // Herramienta de resumen para el chat.
  const summary = await $.tool.call({ tool: 'mcp__oficina__resumen' } as never)
  expect(String((summary as { result?: unknown }).result)).toMatch(/tienda[\s\S]*Rediseño de la tienda[\s\S]*Ahora: Probar pagos/)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Fijar una oficina.
  await ui.press({ key: 'pin-c:\\repo\\informes' })
  expect(await ui.find({ key: 'pin-c:\\repo\\informes' })).toBeDefined()

  // Entrar a la oficina "tienda": avance del proyecto y filas de hilos.
  await ui.press({ key: 'enter-c:\\repo\\tienda' })
  expect(await ui.find({ type: 'Text', text: /2\/4 pasos/ })).toBeDefined()

  // Pedir avance a todos (con confirmación): solo al hilo que no está trabajando.
  await ui.press({ key: 'bc' })
  await ui.press({ key: 'bc-yes' })
  expect(calls.filter(c => c.tool === 'mcp__ccd_session_mgmt__send_message').map(c => c.session_id)).toEqual(['local_c3'])

  // Crear un hilo nuevo en la carpeta del proyecto.
  await ui.press({ key: 'new' })
  await ui.input({ key: 'new-c:\\repo\\tienda', text: 'Revisa el formulario de registro' })
  const created = calls.find(c => c.tool === 'mcp__ccd_session__start_session')
  expect(created?.cwd).toBe('C:\\repo\\tienda')
  expect(created?.prompt).toBe('Revisa el formulario de registro')

  // Abrir un hilo y darle instrucciones.
  await ui.press({ key: 'open-a1' })
  expect(await ui.find({ type: 'Text', text: /Probar pagos/ })).toBeDefined()
  await ui.press({ key: 'q-how' })
  expect(await ui.find({ type: 'Text', text: /Entregada/ })).toBeDefined()
  await ui.input({ key: 'instr-a1-1', text: 'Agrega pruebas al carrito' })
  const sent = calls.filter(c => c.tool === 'mcp__ccd_session_mgmt__send_message' && c.session_id === 'local_a1').map(c => c.message)
  expect(sent).toEqual([
    'Dame un resumen corto de cómo vas: qué está hecho, qué falta y si algo te bloquea.',
    'Agrega pruebas al carrito',
  ])

  // Archivar pide confirmación antes de llamar a la herramienta.
  await ui.press({ key: 'archive' })
  expect(calls.some(c => c.tool === 'mcp__ccd_session_mgmt__archive_session')).toBe(false)
  await ui.press({ key: 'archive-yes' })
  expect(calls.find(c => c.tool === 'mcp__ccd_session_mgmt__archive_session')?.session_id).toBe('local_a1')
  await ui.unmount()
})
