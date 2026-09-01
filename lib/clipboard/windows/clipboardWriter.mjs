import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const helperPath = fileURLToPath(
  new URL('../../../windows-clipboard/bin/clipboard.exe', import.meta.url),
)

const createWriter = () => {
  const write = (input) => {
    const cliTool = spawn(helperPath, ['--set'], { windowsHide: true })

    cliTool.on('error', (err) => {
      console.error('clipboard.exe spawn error:', err.message)
    })
    cliTool.stdin.on('error', (err) => {
      console.error('clipboard.exe stdin error:', err.message)
    })

    try {
      cliTool.stdin.write(input + '\n')
      cliTool.stdin.end()
    } catch (err) {
      console.error('clipboard.exe write failed:', err.message)
    }
  }

  // No persistent process to stop (clipboard.exe is spawned per write);
  // provided for interface parity with the linux writer.
  write.stop = () => {}

  return write
}

export default createWriter
