// Pictures next to a document ("assets/…"), shared by the Markdown and HTML bridges.

import * as fs from './storage'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
}

export function mimeOf(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/')) || fs.ROOT
}

/** Store picture bytes beside `docPath`; returns the path to author ("assets/x.png") */
export async function saveAsset(docPath: string, base64: string, ext: string): Promise<string> {
  const clean = ext.replace(/^\./, '').toLowerCase() || 'png'
  const name = `${fs.cleanName(fs.stem(docPath))}-${Date.now().toString(36)}.${clean}`
  await fs.writeBytes(`${dirOf(docPath)}/assets/${name}`, fs.fromBase64(base64))
  return `assets/${name}`
}

/** Resolve an authored src ("assets/x.png", "/IeumOffice/…") to a library path */
export function assetPath(docPath: string | null, src: string): string | null {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null
  if (src.startsWith('/')) return src
  if (!docPath) return null
  return `${dirOf(docPath)}/${src.replace(/^\.\//, '')}`
}

export async function readAsset(
  docPath: string | null,
  src: string,
): Promise<{ base64: string; mime: string } | null> {
  if (src.startsWith('data:')) {
    const m = /^data:([^;,]+);base64,(.*)$/.exec(src)
    return m ? { mime: m[1]!, base64: m[2]! } : null
  }
  const path = assetPath(docPath, decodeURIComponent(src))
  if (!path) return null
  try {
    const bytes = await fs.readBytes(path)
    return { base64: fs.toBase64(bytes), mime: mimeOf(fs.extOf(path)) }
  } catch {
    return null
  }
}

/** Let the user choose a picture from the tablet (gallery / files) */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    // a canceled picker fires no change event; focus comes back instead
    window.addEventListener(
      'focus',
      () => setTimeout(() => !input.files?.length && resolve(null), 800),
      {
        once: true,
      },
    )
    input.click()
  })
}

export async function fileToBase64(file: File): Promise<string> {
  return fs.toBase64(new Uint8Array(await file.arrayBuffer()))
}

/**
 * The desktop shows local pictures through a custom `md-asset://` protocol the
 * main process serves. A WebView has no such protocol, so swap those URLs for
 * ones that load from the app's storage whenever the editor renders them.
 */
export function installAssetImages(scheme: string): void {
  const cache = new Map<string, Promise<string>>()
  const fix = (img: HTMLImageElement) => {
    const src = img.getAttribute('src') ?? ''
    if (!src.startsWith(scheme)) return
    let path = src.slice(scheme.length)
    try {
      path = decodeURIComponent(path)
    } catch {
      /* keep as is */
    }
    if (!path.startsWith('/')) path = `/${path}`
    let url = cache.get(path)
    if (!url) cache.set(path, (url = fs.displayUrl(path).catch(() => '')))
    void url.then((u) => {
      if (u && img.getAttribute('src') === src) img.setAttribute('src', u)
    })
  }
  const scan = (root: ParentNode) => root.querySelectorAll?.('img').forEach(fix)
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.target instanceof HTMLImageElement) fix(r.target)
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLImageElement) fix(n)
        else if (n instanceof Element) scan(n)
      })
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src'],
  })
}
