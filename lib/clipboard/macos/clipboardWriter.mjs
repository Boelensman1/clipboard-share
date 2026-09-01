import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const helperPath = fileURLToPath(
  new URL('../../../macos-pasteboard/bin/pbv', import.meta.url),
)

const createWriter = () => {
  const write = (input) => {
    const cliTool = spawn(helperPath, ['-p'])

    cliTool.on('error', (err) => {
      console.error('pbv spawn error:', err.message)
    })
    cliTool.stdin.on('error', (err) => {
      console.error('pbv stdin error:', err.message)
    })

    try {
      cliTool.stdin.write(input + '\n')
      cliTool.stdin.end()
    } catch (err) {
      console.error('pbv write failed:', err.message)
    }
  }

  // No persistent process to stop (pbv is spawned per write); provided for
  // interface parity with the linux writer.
  write.stop = () => {}

  return write
}

export default createWriter
