export type OficinaStep = { content: string; status: 'pending' | 'in_progress' | 'completed' }

export type OficinaStatus = 'trabajando' | 'espera' | 'hoy' | 'semana' | 'dormido'

export type OficinaThread = {
  id: string
  title: string
  project: string
  projectName: string
  cwd: string | null
  branch: string | null
  worktree: string | null
  created: string
  updated: string
  msgs: number
  plan: OficinaStep[] | null
  recap: string | null
  ask: string | null
  last: string | null
  status: OficinaStatus
  sessionId: string | null
  link: string | null
}

export type OficinaProject = {
  key: string
  name: string
  path: string | null
  updated: string
  threads: OficinaThread[]
}

export type OficinaData = {
  generated: string
  isLive: boolean
  error: string | null
  projects: OficinaProject[]
}

export type OficinaView =
  | { screen: 'home' }
  | { screen: 'project'; key: string }
  | { screen: 'thread'; key: string; id: string }

export type OficinaSend = {
  count: number
  threadId: string | null
  status: 'idle' | 'sending' | 'sent' | 'relayed' | 'error'
  detail: string
}

export type OficinaUi = {
  /** Acción esperando un segundo clic de confirmación, p. ej. "archive:<id>" o "broadcast:<key>". */
  confirm: string | null
  /** Proyecto donde se está escribiendo un hilo nuevo. */
  composing: string | null
  notice: { text: string; tone: 'ok' | 'error' | 'info' } | null
}

declare module 'claude-code' {
  interface PluginState {
    oficina: {
      data: Shaped<OficinaData | null>
      view: Shaped<OficinaView>
      send: Shaped<OficinaSend>
      showSleeping: Shaped<boolean>
      busy: Shaped<boolean>
      requested: Shaped<number>
      pins: Shaped<string[]>
      ui: Shaped<OficinaUi>
    }
  }
}
