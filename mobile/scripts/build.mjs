// Build the web part of the Android app into mobile/www:
//   www/index.html        Home (document library)
//   www/markdown/…        the desktop Markdown editor + its mobile bridge
//   www/html/…            the desktop HTML editor + its mobile bridge
//   www/mindmap/…         the desktop Mind map editor + its mobile bridge
//
// The editors are built from the untouched desktop sources in apps/*; only a
// bridge script is put in front of each, so upstream updates keep merging.

import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { build } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const mobile = resolve(here, '..')
const repo = resolve(mobile, '..')
const www = resolve(mobile, 'www')

// same list as apps/markdown/vite.renderer.config.ts
const TIPTAP_DEDUPE = [
  '@tiptap/core',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/extensions',
  '@tiptap/extension-list',
  '@tiptap/extension-table',
  '@tiptap/extension-image',
  '@tiptap/suggestion',
  '@tiptap/markdown',
  '@tiptap/extension-highlight',
  '@tiptap/extension-code-block',
]

const EDITORS = [
  { id: 'markdown', dedupe: TIPTAP_DEDUPE },
  { id: 'html', dedupe: [] },
  { id: 'mindmap', dedupe: [] },
]

/** Put the mobile bridge in front of the editor's own entry script */
function mobileBridge(id) {
  const virtualId = `/@ieum-bridge/${id}`
  return {
    name: 'ieum-mobile-bridge',
    enforce: 'pre',
    resolveId(source) {
      if (source === virtualId) return resolve(mobile, 'src/bridge', `${id}.ts`)
      return null
    },
    transformIndexHtml(html) {
      return (
        html
          // the desktop CSP only allows the Electron protocols; the WebView needs its own origin
          .replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i, '')
          .replace(/<html lang="[^"]*"/, '<html lang="ko"')
          .replace(
            '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
            '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
          )
          .replace(
            /<script type="module" src="\.\/main\.tsx"><\/script>/,
            `<script type="module" src="${virtualId}"></script>\n    $&`,
          )
      )
    },
  }
}

rmSync(www, { recursive: true, force: true })

await build({
  configFile: false,
  root: resolve(mobile, 'src/home'),
  base: './',
  logLevel: 'warn',
  build: { outDir: www, emptyOutDir: false },
})
console.log('✓ home')

for (const editor of EDITORS) {
  await build({
    configFile: false,
    root: resolve(repo, 'apps', editor.id, 'src/renderer'),
    base: './',
    logLevel: 'warn',
    plugins: [mobileBridge(editor.id), react()],
    resolve: { dedupe: editor.dedupe },
    // escape non-ASCII in the bundles: some hosts and WebViews mis-read raw bytes
    esbuild: { charset: 'ascii' },
    build: {
      outDir: resolve(www, editor.id),
      emptyOutDir: true,
      chunkSizeWarningLimit: 8000,
    },
  })
  console.log(`✓ ${editor.id}`)
}
