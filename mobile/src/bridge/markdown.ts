// window.markdownApi for the Android app (desktop: apps/markdown/src/preload)

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
import { fileToBase64, installAssetImages, pickImageFile, readAsset, saveAsset } from './assets'
import { shareFile } from './share'

setExportOptions([{ label: 'Word 문서 (.docx)', format: 'docx' }])
installAssetImages('md-asset://')

const api = {
  ...shellSettings,
  consumePending,
  takeSeed: async () => null,
  takeNoteAppend: async () => [],
  recoveryOpen: async () => null,
  writeRecoveryCopy: async () => '',

  readFile: (path: string) => fs.readText(path),

  async save(req: { text: string; mode: 'save' | 'saveAs'; suggestedName?: string }) {
    try {
      let path = getCurrentPath()
      if (!path || req.mode === 'saveAs') {
        const fallback = req.suggestedName || (path ? fs.stem(path) : '새 메모')
        const name = await askName('파일 이름', fallback)
        if (name == null) {
          settleSave(false)
          return { ok: true, canceled: true }
        }
        path = await fs.uniquePath(name, 'md')
      }
      await fs.writeText(path, req.text)
      setCurrentPath(path)
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
    const ext = file.name.split('.').pop() || 'png'
    return saveAsset(doc, await fileToBase64(file), ext)
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

  getMarkdownTheme: async () => localStorage.getItem('ieumoffice.mdTheme') ?? 'default',
  setMarkdownTheme: async (theme: string) => {
    localStorage.setItem('ieumoffice.mdTheme', theme)
    return theme
  },
  getImageHost: async () => null,
  setImageHost: async () => null,
  uploadImage: async () => ({ ok: false, error: '모바일에서는 이미지 호스팅을 쓸 수 없습니다.' }),

  // a wiki of one folder: no cross-note links yet
  resolveWikiLinks: async () => ({}),
  rememberWikiFragment: async () => {},
  takeWikiFragment: async () => '',
  listWikiNotes: async () => [],
  wikiHeads: async () => [],
  wikiBacklinks: async () => [],
  wikiTags: async () => [],
  wikiGraph: async () => ({ nodes: [], edges: [] }),
  createWikiNote: async () => ({ ok: false }),

  async exportDocx(req: { base64: string; suggestedName: string }) {
    const ok = await shareFile(
      `${req.suggestedName || '문서'}.docx`,
      fs.fromBase64(req.base64),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    return ok ? { ok: true, path: '' } : { ok: true, canceled: true }
  },
  exportPdf: async () => ({ ok: false, error: 'PDF 내보내기는 다음 단계에서 추가됩니다.' }),
  exportOdt: async () => ({ ok: false, error: 'ODT 내보내기는 지원하지 않습니다.' }),
}

;(window as any).markdownApi = makeBridge('markdownApi', api)
