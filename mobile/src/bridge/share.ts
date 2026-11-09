// Hand a file to another app (Drive, KakaoTalk, e-mail, Files …) through
// Android's share sheet. In a desktop browser the file is downloaded instead.

import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { cleanName, toBase64 } from './storage'

export async function shareFile(
  fileName: string,
  bytes: Uint8Array,
  mime: string,
): Promise<boolean> {
  const name = cleanName(fileName)
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return true
  }
  const path = `share/${name}`
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: toBase64(bytes),
    recursive: true,
  })
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
  try {
    await Share.share({ title: name, files: [uri], dialogTitle: `${name} 보내기` })
    return true
  } catch (err) {
    // closing the share sheet without picking an app rejects with "canceled"
    if (String(err).toLowerCase().includes('cancel')) return false
    throw err
  }
}
