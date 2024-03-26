import { spawn } from 'child_process'

const createWriter = () => {
  return (input) => {
    const cliTool = spawn('./macos-pasteboard/bin/pbv', ['-p'])
    cliTool.stdin.write(input + '\n')
  }
}

export default createWriter
