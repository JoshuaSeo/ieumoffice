// window.htmlApi for the Android app (desktop: apps/html/src/preload)

import { Capacitor } from '@capacitor/core'
import { buildPreviewDocument } from '../../../apps/html/src/main/preview-document'
import * as fs from './storage'
import {
  askName,
  notify,
  consumePending,
  getCurrentPath,
  makeBridge,
  setCurrentPath,
  setDirty,
  setExportOptions,
  settleSave,
  shellSettings,
  toast,
} from './common'
import { fileToBase64, pickImageFile, readAsset, saveAsset } from './assets'
import { shareFile } from './share'

setExportOptions([{ label: 'HTML 파일 (.html)', format: 'html' }])

// ---------- the preview frame ----------
// On the desktop the preview iframe loads `html-preview://…`, which the main
// process answers with the latest buffer. Here the same URL is caught when the
// editor sets it on an <iframe>, and the buffer goes in through `srcdoc`.

const PREVIEW_URL = 'ieum-preview://view/'
let buffer = ''
let baseHref: string | null = null

async function refreshBase(): Promise<void> {
  const doc = getCurrentPath()
  const uri = doc ? await fs.nativeUri(doc.slice(0, doc.lastIndexOf('/'))) : null
  // convertFileSrc turns file:// into the WebView's own https://localhost/_capacitor_file_/…
  baseHref = uri ? `${Capacitor.convertFileSrc(uri).replace(/\/$/, '')}/` : null
}

function previewHtml(): string {
  return buildPreviewDocument(buffer, baseHref)
}

const nativeSetAttribute = Element.prototype.setAttribute
Element.prototype.setAttribute = function (name: string, value: string) {
  if (
    this instanceof HTMLIFrameElement &&
    name === 'src' &&
    String(value).startsWith(PREVIEW_URL)
  ) {
    this.srcdoc = previewHtml()
    return
  }
  return nativeSetAttribute.call(this, name, value)
}
const srcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')!
Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
  ...srcDesc,
  set(value: string) {
    if (String(value).startsWith(PREVIEW_URL)) this.srcdoc = previewHtml()
    else srcDesc.set!.call(this, value)
  },
})

const api = {
  ...shellSettings,
  consumePending,
  takeSeed: async () => null,
  recoveryOpen: async () => null,
  writeRecoveryCopy: async () => '',
  takeGenerateHandoff: async () => null,

  readFile: async (path: string) => {
    const text = await fs.readText(path)
    await refreshBase()
    return text
  },

  updatePreview(text: string) {
    buffer = text
  },
  getPreviewInfo: async () => ({ url: PREVIEW_URL }),
  setPresentFullScreen: async (on: boolean) => {
    try {
      if (on) await document.documentElement.requestFullscreen()
      else if (document.fullscreenElement) await document.exitFullscreen()
    } catch {
      /* not allowed here */
    }
  },
  presentInNewTab: async () => false,

  async save(req: { text: string; mode: 'save' | 'saveAs'; suggestedName?: string }) {
    try {
      let path = getCurrentPath()
      if (!path || req.mode === 'saveAs') {
        const fallback = req.suggestedName || (path ? fs.stem(path) : '새 페이지')
        const name = await askName('파일 이름', fallback)
        if (name == null) {
          settleSave(false)
          return { ok: true, canceled: true }
        }
        path = await fs.uniquePath(name, 'html')
      }
      await fs.writeText(path, req.text)
      setCurrentPath(path)
      await refreshBase()
      setDirty(false)
      settleSave(true)
      return { ok: true, path }
    } catch (err) {
      settleSave(false)
      return { ok: false, error: String(err) }
    }
  },

  async pickImage() {
    const doc = getCurrentPath()
    if (!doc) {
      await notify('그림을 넣으려면 먼저 문서를 저장해 주세요.')
      return null
    }
    const file = await pickImageFile()
    if (!file) return null
    return saveAsset(doc, await fileToBase64(file), file.name.split('.').pop() || 'png')
  },
  async saveImage(data: { base64: string; ext: string }) {
    const doc = getCurrentPath()
    if (!doc) {
      toast('그림을 넣으려면 먼저 문서를 저장해 주세요')
      return null
    }
    return saveAsset(doc, data.base64, data.ext)
  },
  readImage: (src: string) => readAsset(getCurrentPath(), src),

  async exportHtml(req: { html: string; suggestedName: string }) {
    const ok = await shareFile(
      `${req.suggestedName || '페이지'}.html`,
      new TextEncoder().encode(req.html),
      'text/html',
    )
    return ok ? { ok: true, path: '' } : { ok: true, canceled: true }
  },
  exportDocx: async () => ({ ok: false, error: 'Word 내보내기는 다음 단계에서 추가됩니다.' }),
  exportPdf: async () => ({ ok: false, error: 'PDF 내보내기는 다음 단계에서 추가됩니다.' }),
  exportOdt: async () => ({ ok: false, error: 'ODT 내보내기는 지원하지 않습니다.' }),
  printHtml: async () => ({ ok: false, error: '인쇄는 다음 단계에서 추가됩니다.' }),
  installDropOpenBridge: () => {},
}

;(window as any).htmlApi = makeBridge('htmlApi', api)
