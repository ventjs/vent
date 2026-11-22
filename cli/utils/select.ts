import { createInterface, emitKeypressEvents } from 'node:readline'

const style = {
  blue: (text: string) => `\x1b[94m${text}\x1b[0m`,
  gray: (text: string) => `\x1b[90m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
}

const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'

export async function selectService(): Promise<boolean> {
  const input = process.stdin
  const question = 'Do you want to generate a Service?'

  if (!input.isTTY || !process.stdout.isTTY) {
    const rl = createInterface({
      input,
      output: process.stdout,
    })

    try {
      const answer = await new Promise<string>((resolve) => {
        rl.question('\nDo you want to generate a Service?  Yes /  No [y/N]: ', resolve)
      })

      return answer.trim().toLowerCase() === 'y'
    } finally {
      rl.close()
    }
  }

  emitKeypressEvents(input)
  input.setRawMode(true)
  input.resume()
  process.stdout.write(HIDE_CURSOR)

  let selectedIndex = 0
  let rendered = false

  const options = [
    { label: 'Yes', value: true },
    { label: 'No', value: false },
  ]

  // question + options + hint
  const totalLines = options.length + 2

  const clear = () => {
    if (rendered) {
      process.stdout.write(`\x1b[${totalLines}A\r\x1b[J`)
    }
  }

  const render = () => {
    clear()

    const lines = [
      `${style.blue('?')} ${style.bold(question)}`,
      ...options.map((option, index) =>
        selectedIndex === index ? style.blue(`❯ ${option.label}`) : style.gray(`  ${option.label}`),
      ),
      style.gray('↑/↓ to move · enter to select · esc to cancel'),
    ]

    process.stdout.write(lines.map((line) => `${line}\n`).join(''))
    rendered = true
  }

  render()

  return new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      input.removeListener('keypress', onKeypress)
      input.setRawMode(false)
      input.pause()
      process.stdout.write(SHOW_CURSOR)
    }

    const onKeypress = (_: string, key?: { name?: string; ctrl?: boolean }) => {
      // Ignore anything that is not a real key (mouse / focus sequences)
      if (!key?.name) return

      if ((key.ctrl && key.name === 'c') || key.name === 'escape') {
        clear()
        cleanup()
        reject(new Error('Operation cancelled.'))
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        const next = selectedIndex === 0 ? 1 : 0

        if (next !== selectedIndex) {
          selectedIndex = next
          render()
        }
        return
      }

      if (key.name === 'return') {
        const selected = options[selectedIndex]!

        // Collapse the menu into a single answer line
        clear()
        process.stdout.write(
          `${style.blue('?')} ${style.bold(question)} ${style.blue(selected.label)}\n`,
        )

        cleanup()
        resolve(selected.value)
      }
    }

    input.on('keypress', onKeypress)
  })
}
