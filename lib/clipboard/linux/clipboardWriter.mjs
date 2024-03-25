import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { exec } from 'child_process'
import { randomBytes } from 'crypto'

// Function to generate a temporary file name
const generateTempFilePath = (extension) => {
  const randomFileName = randomBytes(16).toString('hex')
  return join(tmpdir(), `${randomFileName}.${extension}`)
}

const setTextToClipboard = (data) => {
  const process = exec('xclip -selection clipboard', (error) => {
    if (error) {
      console.error(`exec error: ${error}`)
      return
    }
  })

  // Write the data to the stdin of the xclip process
  process.stdin.write(data)
  process.stdin.end() // Close the stdin stream
}

const setImageToClipboard = (data) => {
  const tempFilePath = generateTempFilePath('png')

  writeFileSync(tempFilePath, data)

  exec(
    `xclip -selection clipboard -t image/png -i "${tempFilePath}"`,
    (error) => {
      if (error) {
        console.error(`exec error: ${error}`)
        return
      }
    },
  )
}

const createWriter = () => {
  return (rawInput) => {
    // const cliTool = spawn('xclip', [])
    // parse input
    const input = JSON.parse(rawInput)
    const type = input[0]
    const data = Buffer.from(input[1], 'base64')
    switch (type) {
      case 'text/plain':
        return setTextToClipboard(data)
      case 'image/png':
        return setImageToClipboard(data)
      default:
        console.error(`Type ${type} is not supported.`)
    }
  }
}

export default createWriter
