import { spawn } from 'child_process'
import readline from 'readline'
import { EventEmitter } from 'events'
import { fileURLToPath } from 'url'

const helperPath = fileURLToPath(
  new URL('../../../windows-clipboard/bin/clipboard.exe', import.meta.url),
)

const pollClipboard = () => {
  const clipboardEventEmitter = new EventEmitter()
  let destroyed = false

  const cliTool = spawn(helperPath, ['--watch'], { windowsHide: true })

  const rl = readline.createInterface({
    input: cliTool.stdout,
  })

  rl.on('line', (line) => {
    clipboardEventEmitter.emit('data', line)
  })

  // Spawn failures (e.g. ENOENT / helper not built) would otherwise be an
  // unhandled 'error' event and crash the process.
  cliTool.on('error', (err) => {
    if (destroyed) return
    clipboardEventEmitter.emit(
      'error',
      `clipboard.exe spawn error: ${err.message}`,
    )
  })

  // Handle any errors from the CLI tool
  cliTool.stderr.on('data', (data) => {
    if (destroyed) return
    clipboardEventEmitter.emit('error', data.toString())
  })

  cliTool.on('close', (code) => {
    if (destroyed) return
    clipboardEventEmitter.emit('error', `cli closed (${code})`)
  })

  // Tear everything down: kill the child, close readline, drop listeners.
  // Called on reconnect so we don't leak helper processes/listeners.
  clipboardEventEmitter.destroy = () => {
    if (destroyed) return
    destroyed = true
    rl.close()
    clipboardEventEmitter.removeAllListeners()
    try {
      cliTool.kill()
    } catch (err) {
      // process may already be gone
    }
  }

  return clipboardEventEmitter
}

export default pollClipboard
