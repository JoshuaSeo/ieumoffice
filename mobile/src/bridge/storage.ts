// Document library for the Android app.
//
// On the device the files live in the app's private storage (Capacitor
// Filesystem, Directory.Data). In a desktop browser (development / preview)
// the same API is backed by IndexedDB so the editors can be tried without a
// phone. Paths handed to the editors look like "/IeumOffice/Note.md".

import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

export const ROOT = '/IeumOffice'

export interface DocEntry {
  path: string
  name: string
  ext: string
  size: number
  mtime: number
}

const native = Capacitor.isNativePlatform()

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function extOf(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function stem(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function rel(path: string): string {
  return path.replace(/^\/+/, '')
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// ---------- IndexedDB fallback (browser only) ----------

interface IdbRecord {
  path: string
  bytes: Uint8Array
  mtime: number
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('ieumoffice-mobile', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'path' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction('files', mode).objectStore('files'))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

// ---------- public API ----------

async function ensureRoot(): Promise<void> {
  if (!native) return
  try {
    await Filesystem.mkdir({ path: rel(ROOT), directory: Directory.Data, recursive: true })
  } catch {
    /* exists */
  }
}

export async function list(): Promise<DocEntry[]> {
  if (!native) {
    const all = await idb<IdbRecord[]>('readonly', (s) => s.getAll())
    return all
      .filter((r) => !r.path.includes('/assets/'))
      .map((r) => ({
        path: r.path,
        name: baseName(r.path),
        ext: extOf(r.path),
        size: r.bytes.length,
        mtime: r.mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime)
  }
  await ensureRoot()
  const res = await Filesystem.readdir({ path: rel(ROOT), directory: Directory.Data })
  return res.files
    .filter((f) => f.type === 'file')
    .map((f) => {
      const path = `${ROOT}/${f.name}`
      return { path, name: f.name, ext: extOf(path), size: f.size, mtime: f.mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

export async function exists(path: string): Promise<boolean> {
  if (!native) return (await idb<IdbRecord | undefined>('readonly', (s) => s.get(path))) != null
  try {
    await Filesystem.stat({ path: rel(path), directory: Directory.Data })
    return true
  } catch {
    return false
  }
}

export async function readBytes(path: string): Promise<Uint8Array> {
  if (!native) {
    const r = await idb<IdbRecord | undefined>('readonly', (s) => s.get(path))
    if (!r) throw new Error(`파일이 없습니다: ${path}`)
    return r.bytes
  }
  const res = await Filesystem.readFile({ path: rel(path), directory: Directory.Data })
  return typeof res.data === 'string'
    ? fromBase64(res.data)
    : new Uint8Array(await (res.data as Blob).arrayBuffer())
}

export async function readText(path: string): Promise<string> {
  if (!native) return new TextDecoder().decode(await readBytes(path))
  const res = await Filesystem.readFile({
    path: rel(path),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  })
  return typeof res.data === 'string' ? res.data : await (res.data as Blob).text()
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  if (!native) {
    await idb('readwrite', (s) => s.put({ path, bytes: new Uint8Array(bytes), mtime: Date.now() }))
    return
  }
  await ensureRoot()
  await Filesystem.writeFile({
    path: rel(path),
    directory: Directory.Data,
    data: toBase64(bytes),
    recursive: true,
  })
}

export async function writeText(path: string, text: string): Promise<void> {
  if (!native) return writeBytes(path, new TextEncoder().encode(text))
  await ensureRoot()
  await Filesystem.writeFile({
    path: rel(path),
    directory: Directory.Data,
    data: text,
    encoding: Encoding.UTF8,
    recursive: true,
  })
}

export async function remove(path: string): Promise<void> {
  if (!native) {
    await idb('readwrite', (s) => s.delete(path))
    return
  }
  await Filesystem.deleteFile({ path: rel(path), directory: Directory.Data })
}

export async function rename(from: string, to: string): Promise<void> {
  if (!native) {
    const bytes = await readBytes(from)
    await writeBytes(to, bytes)
    await remove(from)
    return
  }
  await Filesystem.rename({
    from: rel(from),
    to: rel(to),
    directory: Directory.Data,
    toDirectory: Directory.Data,
  })
}

/** Characters Android and Windows both refuse in a file name */
export function cleanName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .trim()
      .slice(0, 120) || '제목 없음'
  )
}

/** A path in the library for `name.ext` that no file uses yet ("Name (2).ext" …) */
export async function uniquePath(name: string, ext: string): Promise<string> {
  const base = cleanName(name)
  let path = `${ROOT}/${base}.${ext}`
  for (let n = 2; await exists(path); n++) path = `${ROOT}/${base} (${n}).${ext}`
  return path
}

/** Native file URL for a library file (used to show pictures in the editor) */
export async function displayUrl(path: string): Promise<string> {
  if (!native) {
    const bytes = await readBytes(path)
    const mime = extOf(path) === 'svg' ? 'image/svg+xml' : `image/${extOf(path) || 'png'}`
    return URL.createObjectURL(new Blob([bytes], { type: mime }))
  }
  const { uri } = await Filesystem.getUri({ path: rel(path), directory: Directory.Data })
  return Capacitor.convertFileSrc(uri)
}

export async function nativeUri(path: string): Promise<string | null> {
  if (!native) return null
  const { uri } = await Filesystem.getUri({ path: rel(path), directory: Directory.Data })
  return uri
}

export const isNative = native
