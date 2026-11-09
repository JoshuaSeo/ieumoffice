// Shared pieces of the editor bridges.
//
// On the desktop each editor talks to an Electron main process through
// `window.<name>Api`. Here there is no main process: every editor page loads
// one of the bridge scripts first, which puts an object with the same shape on
// `window`. Methods the phone cannot do yet answer "nothing" instead of
// throwing, so the editor keeps working and simply hides or skips the feature.

import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { DEFAULT_AI_PANEL_PREFS } from '@genoffice/ui/ai-panel-prefs'
import { askText, choose, notify } from './dialog'
import './chrome.css'

export { notify }

type Handler = (...args: any[]) => void

// ---------- events the editors subscribe to ----------

const listeners = new Map<string, Set<Handler>>()

export function on(event: string, handler: Handler): () => void {
  let set = listeners.get(event)
  if (!set) listeners.set(event, (set = new Set()))
  set.add(handler)
  return () => set!.delete(handler)
}

export function emit(event: string, ...args: unknown[]): number {
  const set = listeners.get(event)
  set?.forEach((h) => {
    try {
      h(...args)
    } catch (err) {
      console.error(`[bridge] ${event} handler failed`, err)
    }
  })
  return set?.size ?? 0
}

// ---------- the document this page edits ----------

const params = new URLSearchParams(location.search)
let currentPath: string | null = params.get('path')
let pendingTaken = false

/** The path the editor should open (taken once, like the desktop's consumePending) */
export function consumePending(): Promise<string | null> {
  if (pendingTaken) return Promise.resolve(null)
  pendingTaken = true
  return Promise.resolve(currentPath)
}

export function getCurrentPath(): string | null {
  return currentPath
}

/** Remember the file the document now lives in (after a first save or Save As) */
export function setCurrentPath(path: string): void {
  if (path === currentPath) return
  currentPath = path
  const url = new URL(location.href)
  url.searchParams.set('path', path)
  history.replaceState(null, '', url.toString())
}

// ---------- unsaved changes & leaving the editor ----------

let dirty = false
let saveWaiter: ((ok: boolean) => void) | null = null

export function setDirty(value: boolean): void {
  dirty = value
}

/** The bridge's save() calls this when a save finished (or was canceled) */
export function settleSave(ok: boolean): void {
  const w = saveWaiter
  saveWaiter = null
  w?.(ok)
}

/** Ask the editor to save itself, the way the desktop menu's Save does */
export function requestSave(mode: 'save' | 'saveAs' = 'save'): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(false), 20000)
    const settle = (ok: boolean) => {
      clearTimeout(timer)
      resolve(ok)
    }
    saveWaiter = settle
    if (emit('saveRequest', mode) === 0) settleSave(false)
  })
}

let leaving = false
async function goHome(): Promise<void> {
  if (leaving) return
  leaving = true
  try {
    if (dirty) {
      const pick = await choose('저장하지 않은 내용이 있습니다', '홈으로 나가기 전에 저장할까요?', [
        { label: '계속 편집', value: 'stay' },
        { label: '저장 안 함', value: 'discard', kind: 'danger' },
        { label: '저장', value: 'save', kind: 'primary' },
      ])
      if (pick === null || pick === 'stay') return
      if (pick === 'save') {
        const ok = await requestSave('save')
        if (!ok) return
      }
    }
    location.href = '../index.html'
  } finally {
    leaving = false
  }
}

// ---------- names (replaces the desktop's Save dialog) ----------

export function askName(title: string, defaultName: string): Promise<string | null> {
  return askText(title, defaultName, '저장')
}

// ---------- settings the shell used to own ----------

const PREFS_KEY = 'ieumoffice.prefs'

interface Prefs {
  theme: 'light' | 'dark' | 'system'
  autoSave: boolean
}

export function prefs(): Prefs {
  try {
    return {
      theme: 'system',
      autoSave: true,
      ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'),
    }
  } catch {
    return { theme: 'system', autoSave: true }
  }
}

export function setPrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs(), ...patch }))
  } catch {
    /* private mode */
  }
}

/** Everything the editors ask about the app's look and language */
export const shellSettings = {
  getLanguage: async () => 'ko',
  onLanguageChanged: () => () => {},
  getTheme: async () => prefs().theme,
  onThemeChanged: (h: Handler) => on('theme', h),
  getDocumentTheme: async () => 'follow',
  onDocumentThemeChanged: () => () => {},
  getAutoSaveDefault: async () => ({ on: prefs().autoSave, updatedAt: 0 }),
  onAutoSaveDefaultChanged: () => () => {},
  // the AI panel comes in a later step; hide it until then
  getAiPanelPrefs: async () => ({ ...DEFAULT_AI_PANEL_PREFS, showAiSidebar: false }),
  setAiPanelPrefs: async () => ({ ...DEFAULT_AI_PANEL_PREFS, showAiSidebar: false }),
  onAiPanelPrefsChanged: () => () => {},
  onChromePressed: () => () => {},
  getAiSettings: async () => ({ provider: 'auto', providers: {} }),
  setAiSettings: async () => {},
  onAiSettingsChanged: () => () => {},
  aiToolCapabilities: async () => null,
  aiStream: async () => {
    throw new Error('AI 기능은 아직 모바일 앱에서 쓸 수 없습니다.')
  },
  onAiStream: () => () => {},
  // menu requests the shell used to send
  onSaveRequest: (h: Handler) => on('saveRequest', h),
  onCloseSaveRequest: () => () => {},
  onExportRequest: (h: Handler) => on('exportRequest', h),
  onPrintRequest: (h: Handler) => on('printRequest', h),
  onFileRenamed: () => () => {},
  onReadTextRequest: () => () => {},
  onRecoveryFlushRequest: () => () => {},
  setDirty,
  sendSaveRequestAck: (ok: boolean) => settleSave(ok),
  sendCloseSaveResult: () => {},
  sendReadTextResult: () => {},
  openSourcePath: async () => {},
  openAiModelSettings: async () => {
    await notify('AI 설정은 다음 단계에서 추가됩니다.')
  },
  consumeHeadlessExport: async () => null,
  headlessExportDone: () => {},
  setProvisionalTitle: (title: string) => {
    if (title) document.title = title
  },
}

/**
 * Wrap a bridge so every method the phone does not have yet answers quietly.
 * `onX` subscriptions return an unsubscribe; anything else resolves to null.
 */
export function makeBridge<T extends object>(name: string, impl: T): T {
  const missing = new Set<string>()
  return new Proxy(impl as any, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON') return undefined
      if (!missing.has(prop)) {
        missing.add(prop)
        console.info(`[bridge] ${name}.${prop} is not available on mobile yet`)
      }
      if (/^on[A-Z]/.test(prop)) return () => () => {}
      if (prop === 'aiSubscription') return makeBridge(`${name}.aiSubscription`, {})
      return async () => null
    },
  })
}

// ---------- the app chrome: Home button, Android back button ----------

export interface ExportOption {
  label: string
  /** the format the editor's export handler understands ('docx', 'png', …) */
  format: string
}

let exportOptions: ExportOption[] = []

/** The formats this editor can export; shown under the "내보내기" button */
export function setExportOptions(options: ExportOption[]): void {
  exportOptions = options
}

function openExportMenu(anchor: HTMLElement): void {
  document.querySelector('.m-menu')?.remove()
  const menu = document.createElement('div')
  menu.className = 'm-menu'
  for (const opt of exportOptions) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = opt.label
    b.onclick = () => {
      menu.remove()
      if (emit('exportRequest', opt.format) === 0)
        void notify('이 편집기는 아직 내보내기를 지원하지 않습니다.')
    }
    menu.appendChild(b)
  }
  const r = anchor.getBoundingClientRect()
  menu.style.right = `${window.innerWidth - r.right}px`
  menu.style.bottom = `${window.innerHeight - r.top + 8}px`
  document.body.appendChild(menu)
  setTimeout(() =>
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!menu.contains(e.target as Node)) menu.remove()
      },
      { once: true },
    ),
  )
}

function installChrome(): void {
  const bar = document.createElement('div')
  bar.className = 'm-chrome'
  bar.innerHTML = `
    <button type="button" class="m-chrome-btn" data-act="home" title="홈으로">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 3 2 12h3v8h6v-6h2v6h6v-8h3z"/></svg>
      <span>홈</span>
    </button>
    <button type="button" class="m-chrome-btn" data-act="save" title="저장">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10z"/></svg>
      <span>저장</span>
    </button>
    ${
      exportOptions.length
        ? `<button type="button" class="m-chrome-btn" data-act="export" title="내보내기">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg>
      <span>내보내기</span>
    </button>`
        : ''
    }`
  bar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button')
    const act = btn?.dataset.act
    if (act === 'home') void goHome()
    if (act === 'export' && btn) openExportMenu(btn)
    if (act === 'save') {
      void requestSave('save').then((ok) => ok && toast('저장했습니다'))
    }
  })
  document.body.appendChild(bar)

  if (Capacitor.isNativePlatform()) {
    void CapApp.addListener('backButton', () => void goHome())
  }
  // desktop keyboard habit, also on tablets with a keyboard
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void requestSave(e.shiftKey ? 'saveAs' : 'save').then((ok) => ok && toast('저장했습니다'))
    }
  })
}

export function toast(text: string): void {
  const el = document.createElement('div')
  el.className = 'm-toast'
  el.textContent = text
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 1800)
}

// after the editor's bridge module has finished (it sets the export options)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installChrome)
} else {
  setTimeout(installChrome, 0)
}
