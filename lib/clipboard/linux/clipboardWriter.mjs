import { spawn } from 'child_process'

const pollClipboard = () => {
  const cliTool = spawn('./linux-clipboard/clipboard-write.py', [])

  // Handle any errors from the CLI tool
  cliTool.stderr.on('data', (data) => {
    console.error('error in clipboardReader', data.toString())
  })

  cliTool.stdout.on('data', (data) => {
    console.log(data.toString())
  })

  cliTool.on('close', (code) => {
    throw new Error('Clipboard-write closed!')
  })

  return (input) => {
    cliTool.stdin.write(input + '\n')
  }
}

export default pollClipboard
