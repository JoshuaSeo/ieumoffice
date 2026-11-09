// Small in-page dialogs (in place of the browser's prompt/confirm/alert, which
// look out of place on a tablet and are blocked in some web views).

import './dialog.css'

interface Button {
  label: string
  value: string
  kind?: 'primary' | 'danger' | 'plain'
}

function show(opts: {
  title: string
  message?: string
  input?: string
  buttons: Button[]
}): Promise<{ button: string | null; text: string }> {
  return new Promise((resolve) => {
    const back = document.createElement('div')
    back.className = 'm-dlg-back'
    const box = document.createElement('div')
    box.className = 'm-dlg'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')

    const h = document.createElement('h2')
    h.textContent = opts.title
    box.appendChild(h)
    if (opts.message) {
      const p = document.createElement('p')
      p.textContent = opts.message
      box.appendChild(p)
    }
    let input: HTMLInputElement | null = null
    if (opts.input != null) {
      input = document.createElement('input')
      input.type = 'text'
      input.value = opts.input
      input.id = 'm-dlg-input'
      box.appendChild(input)
    }
    const row = document.createElement('div')
    row.className = 'm-dlg-buttons'
    const done = (button: string | null) => {
      back.remove()
      resolve({ button, text: input?.value.trim() ?? '' })
    }
    for (const b of opts.buttons) {
      const el = document.createElement('button')
      el.type = 'button'
      el.textContent = b.label
      el.className = `m-dlg-btn ${b.kind ?? 'plain'}`
      el.onclick = () => done(b.value)
      row.appendChild(el)
    }
    box.appendChild(row)
    back.appendChild(box)
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) done(null)
    })
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null)
      if (e.key === 'Enter' && input) {
        e.preventDefault()
        const primary = opts.buttons.find((b) => b.kind === 'primary')
        done(primary?.value ?? null)
      }
    })
    document.body.appendChild(back)
    if (input) {
      input.focus()
      input.select()
    } else {
      row.querySelector<HTMLButtonElement>('.primary')?.focus()
    }
  })
}

/** Ask for a line of text; null when canceled */
export async function askText(
  title: string,
  value: string,
  okLabel = '확인',
): Promise<string | null> {
  const r = await show({
    title,
    input: value,
    buttons: [
      { label: '취소', value: 'cancel' },
      { label: okLabel, value: 'ok', kind: 'primary' },
    ],
  })
  if (r.button !== 'ok') return null
  return r.text || value
}

/** Pick one of the buttons; null when the dialog was dismissed */
export async function choose(
  title: string,
  message: string,
  buttons: Button[],
): Promise<string | null> {
  return (await show({ title, message, buttons })).button
}

export async function confirmDanger(
  title: string,
  message: string,
  okLabel: string,
): Promise<boolean> {
  return (
    (await choose(title, message, [
      { label: '취소', value: 'cancel' },
      { label: okLabel, value: 'ok', kind: 'danger' },
    ])) === 'ok'
  )
}

export async function notify(title: string, message = ''): Promise<void> {
  await show({ title, message, buttons: [{ label: '확인', value: 'ok', kind: 'primary' }] })
}
