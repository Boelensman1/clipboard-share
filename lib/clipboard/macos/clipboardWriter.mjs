import { spawn } from 'child_process'

const createWriter = () => {
  const cliTool = spawn('./macos-pasteboard/bin/pbv', ['-p'])

  return (input) => {
    cliTool.stdin.write(input + '\n')
  }
}

export default createWriter
