import { spawn } from 'child_process'
import readline from 'readline'
import { EventEmitter } from 'events'
import { fileURLToPath } from 'url'

const helperPath = fileURLToPath(
  new URL('../../../macos-pasteboard/bin/pbv', import.meta.url),
)

const pollClipboard = () => {
  const clipboardEventEmitter = new EventEmitter()
  let destroyed = false

  const cliTool = spawn(helperPath, ['-s'])

  const rl = readline.createInterface({
    input: cliTool.stdout,
  })

  rl.on('line', (line) => {
    clipboardEventEmitter.emit('data', line)
  })

  // Spawn failures (e.g. ENOENT) would otherwise crash the process.
  cliTool.on('error', (err) => {
    if (destroyed) return
    clipboardEventEmitter.emit('error', `pbv spawn error: ${err.message}`)
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
