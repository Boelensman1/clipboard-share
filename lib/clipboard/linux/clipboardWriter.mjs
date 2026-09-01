import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const helperPath = fileURLToPath(
  new URL('../../../linux-clipboard/clipboard-write.py', import.meta.url),
)

const pollClipboard = () => {
  let cliTool = null
  let stopped = false

  const spawnHelper = () => {
    const proc = spawn(helperPath, [])

    proc.stderr.on('data', (data) => {
      console.error('error in clipboardWriter', data.toString())
    })

    proc.stdout.on('data', (data) => {
      console.log(data.toString())
    })

    // Spawn failures (ENOENT etc.) must not crash the process.
    proc.on('error', (err) => {
      console.error('clipboard-write spawn error:', err.message)
    })

    // The helper exiting used to `throw` here, killing the whole client.
    // Instead log it and lazily respawn on the next write.
    proc.on('close', (code) => {
      console.error(`clipboard-write closed (${code})`)
      if (cliTool === proc) cliTool = null
    })

    // Swallow EPIPE etc. on stdin if the helper is gone.
    proc.stdin.on('error', (err) => {
      console.error('clipboard-write stdin error:', err.message)
    })

    return proc
  }

  const write = (input) => {
    if (stopped) return
    if (!cliTool) cliTool = spawnHelper()
    try {
      cliTool.stdin.write(input + '\n')
    } catch (err) {
      console.error('clipboard-write write failed:', err.message)
      cliTool = null
    }
  }

  // Stop the helper and prevent further writes (called on teardown/reconnect).
  write.stop = () => {
    stopped = true
    if (cliTool) {
      try {
        cliTool.kill()
      } catch (err) {
        // already gone
      }
      cliTool = null
    }
  }

  return write
}

export default pollClipboard
