// Home screen: the document library (replaces the desktop shell's Home tab)

import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import * as fs from '../bridge/storage'
import { shareFile } from '../bridge/share'
import { askText, confirmDanger, notify } from '../bridge/dialog'
import './home.css'

type EditorId = 'markdown' | 'html' | 'mindmap'

const EDITOR_BY_EXT: Record<string, EditorId> = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'markdown',
  html: 'html',
  htm: 'html',
  xmind: 'mindmap',
}

const BADGE: Record<EditorId, { cls: string; text: string }> = {
  markdown: { cls: 'md', text: 'MD' },
  html: { cls: 'html', text: 'HTML' },
  mindmap: { cls: 'map', text: 'MAP' },
}

const MIME: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  xmind: 'application/vnd.xmind.workbook',
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

function open(editor: EditorId, path?: string): void {
  location.href = `./${editor}/index.html${path ? `?path=${encodeURIComponent(path)}` : ''}`
}

function when(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

function size(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

let docs: fs.DocEntry[] = []

async function refresh(): Promise<void> {
  try {
    docs = (await fs.list()).filter((d) => EDITOR_BY_EXT[d.ext])
  } catch (err) {
    console.error(err)
    docs = []
  }
  render()
}

function render(): void {
  const q = $<HTMLInputElement>('#search').value.trim().toLowerCase()
  const shown = q ? docs.filter((d) => d.name.toLowerCase().includes(q)) : docs
  const list = $<HTMLUListElement>('#list')
  list.replaceChildren()
  $('#empty').hidden = shown.length > 0
  for (const doc of shown) {
    const editor = EDITOR_BY_EXT[doc.ext]!
    const li = document.createElement('li')
    li.className = 'doc'
    li.innerHTML = `
      <button type="button" class="doc-open">
        <span class="badge ${BADGE[editor].cls}">${BADGE[editor].text}</span>
        <span class="doc-text">
          <span class="doc-name"></span>
          <span class="doc-meta">${when(doc.mtime)} · ${size(doc.size)}</span>
        </span>
      </button>
      <button type="button" class="doc-more" aria-label="더 보기">⋯</button>`
    li.querySelector('.doc-name')!.textContent = doc.name
    li.querySelector<HTMLButtonElement>('.doc-open')!.onclick = () => open(editor, doc.path)
    li.querySelector<HTMLButtonElement>('.doc-more')!.onclick = (e) =>
      showMenu(e.currentTarget as HTMLElement, doc)
    list.appendChild(li)
  }
}

function showMenu(anchor: HTMLElement, doc: fs.DocEntry): void {
  document.querySelector('.menu')?.remove()
  const menu = document.createElement('div')
  menu.className = 'menu'
  const items: [string, () => Promise<void>, string?][] = [
    [
      '보내기 / 다른 앱에 저장',
      async () => {
        await shareFile(
          doc.name,
          await fs.readBytes(doc.path),
          MIME[doc.ext] ?? 'application/octet-stream',
        )
      },
    ],
    [
      '이름 바꾸기',
      async () => {
        const name = await askText('새 이름', fs.stem(doc.path), '바꾸기')
        if (!name || name === fs.stem(doc.path)) return
        const to = await fs.uniquePath(name, doc.ext)
        await fs.rename(doc.path, to)
      },
    ],
    [
      '삭제',
      async () => {
        if (!(await confirmDanger(`"${doc.name}" 삭제`, '삭제하면 되돌릴 수 없습니다.', '삭제')))
          return
        await fs.remove(doc.path)
      },
      'danger',
    ],
  ]
  for (const [label, run, cls] of items) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    if (cls) b.className = cls
    b.onclick = async () => {
      menu.remove()
      try {
        await run()
      } catch (err) {
        await notify('실패했습니다', err instanceof Error ? err.message : String(err))
      }
      await refresh()
    }
    menu.appendChild(b)
  }
  const r = anchor.getBoundingClientRect()
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 170)}px`
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`
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

async function importFiles(files: FileList): Promise<void> {
  let last: { editor: EditorId; path: string } | null = null
  for (const file of Array.from(files)) {
    const ext = fs.extOf(file.name)
    const editor = EDITOR_BY_EXT[ext]
    if (!editor) {
      await notify('열 수 없는 형식입니다', `"${file.name}"은(는) 아직 이 앱에서 열 수 없습니다.`)
      continue
    }
    const path = await fs.uniquePath(fs.stem(file.name), ext)
    await fs.writeBytes(path, new Uint8Array(await file.arrayBuffer()))
    last = { editor, path }
  }
  if (files.length === 1 && last) open(last.editor, last.path)
  else await refresh()
}

document.querySelectorAll<HTMLButtonElement>('[data-new]').forEach((b) => {
  b.onclick = () => open(b.dataset.new as EditorId)
})
$('#import').onclick = () => $<HTMLInputElement>('#file').click()
$<HTMLInputElement>('#file').onchange = (e) => {
  const input = e.currentTarget as HTMLInputElement
  if (input.files?.length) void importFiles(input.files).finally(() => (input.value = ''))
}
$('#search').oninput = render

if (Capacitor.isNativePlatform()) {
  // the back button on Home leaves the app, as Android users expect
  void CapApp.addListener('backButton', () => void CapApp.exitApp())
}
window.addEventListener('pageshow', () => void refresh())
void refresh()
