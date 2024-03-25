import { spawn } from 'child_process'
import readline from 'readline'
import { EventEmitter } from 'events'

const pollClipboard = () => {
  const clipboardEventEmitter = new EventEmitter()

  const cliTool = spawn('./macos-pasteboard/bin/pbv', ['-s'])

  const rl = readline.createInterface({
    input: cliTool.stdout,
  })

  rl.on('line', (line) => {
    clipboardEventEmitter.emit('data', line)
  })

  // Handle any errors from the CLI tool
  cliTool.stderr.on('data', (data) => {
    clipboardEventEmitter.emit('error', data.toString())
  })

  cliTool.on('close', (code) => {
    clipboardEventEmitter.emit('error', `cli closed (${code})`)
  })
  return clipboardEventEmitter
}

export default pollClipboard
