// window.mindmapApi for the Android app (desktop: apps/mindmap/src/preload)

import * as fs from './storage'
import {
  askName,
  consumePending,
  getCurrentPath,
  makeBridge,
  setCurrentPath,
  setDirty,
  setExportOptions,
  settleSave,
  shellSettings,
} from './common'
import { shareFile } from './share'

setExportOptions([
  { label: '그림 (.png)', format: 'png' },
  { label: '마크다운 개요 (.md)', format: 'markdown' },
])

function shared(ok: boolean) {
  return ok ? { ok: true, path: '' } : { ok: true, canceled: true }
}

const api = {
  ...shellSettings,
  consumePending,
  takeSeed: async () => null,
  takeHandoff: async () => null,
  writeRecoveryCopy: async () => '',
  onRecoveryCopyNow: () => () => {},
  onRecoveryReset: () => () => {},
  onMenuCommand: () => () => {},
  onOutlineRequest: () => () => {},
  onBytesRequest: () => () => {},

  async openFile(path: string) {
    try {
      return { status: 'ok', bytes: await fs.readBytes(path) }
    } catch {
      return { status: 'unreadable' }
    }
  },

  async save(req: {
    bytes: Uint8Array
    mode: 'save' | 'saveAs'
    defaultName?: string
    auto?: boolean
  }) {
    try {
      let path = getCurrentPath()
      if (!path || req.mode === 'saveAs') {
        // an automatic save never asks for a name
        if (req.auto) {
          settleSave(false)
          return { ok: true, canceled: true }
        }
        const fallback = req.defaultName || (path ? fs.stem(path) : '새 마인드맵')
        const name = await askName('파일 이름', fallback)
        if (name == null) {
          settleSave(false)
          return { ok: true, canceled: true }
        }
        path = await fs.uniquePath(name, 'xmind')
      }
      await fs.writeBytes(path, req.bytes)
      setCurrentPath(path)
      setDirty(false)
      settleSave(true)
      return { ok: true, path }
    } catch (err) {
      settleSave(false)
      return { ok: false, error: String(err) }
    }
  },

  openLink: async (url: string) => {
    window.open(url, '_blank')
    return true
  },
  readLinkPreview: async () => ({ ok: false }),

  async exportPng(req: { bytes: Uint8Array; suggestedName: string }) {
    return shared(await shareFile(`${req.suggestedName || '마인드맵'}.png`, req.bytes, 'image/png'))
  },
  async exportMarkdown(req: { text: string; suggestedName: string }) {
    return shared(
      await shareFile(
        `${req.suggestedName || '마인드맵'}.md`,
        new TextEncoder().encode(req.text),
        'text/markdown',
      ),
    )
  },
  exportPdf: async () => ({ ok: false, error: 'PDF 내보내기는 다음 단계에서 추가됩니다.' }),
  print: async () => ({ ok: false, error: '인쇄는 다음 단계에서 추가됩니다.' }),
  installDropOpenBridge: () => {},
}

;(window as any).mindmapApi = makeBridge('mindmapApi', api)
