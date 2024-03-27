import fs from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import os from 'os'
import path from 'path'

import bytes from 'bytes'
import WebSocket from 'ws'
import ClipboardHandler from './lib/clipboard/index.mjs'

import createCryptoLib from './lib/crypto.mjs'

const config = JSON.parse(fs.readFileSync('./config.json').toString())
const { encrypt, decrypt, getKeyHash } = createCryptoLib(
  Buffer.from(config.key, 'base64'),
  Buffer.from(config.salt, 'base64'),
)
const maxFileSize = bytes(config.maxFileSize)
const keyHash = getKeyHash()

let justSet = false

let lastTempFileDir = null

const initClient = (ws) => {
  const clipboardHandler = new ClipboardHandler()

  clipboardHandler.reader.on('data', (line) => {
    if (!justSet) {
      const parsedLine = JSON.parse(line)

      // new clipboard enty, delete old temp file
      if (lastTempFileDir) {
        fs.rmSync(lastTempFileDir, { recursive: true })
        lastTempFileDir = null
      }

      // special handler for files
      const fileUriEntryIndex = parsedLine.findIndex(
        (l) => l[0] === 'text/uri-list',
      )
      if (fileUriEntryIndex >= 0) {
        const fileUriEntry = parsedLine[fileUriEntryIndex]
        const filePath = fileURLToPath(
          Buffer.from(fileUriEntry[1], 'base64').toString(),
        )

        const stat = fs.statSync(filePath)
        if (!stat.isFile()) {
          console.log('Only files are supported atm, removing file uri')
          parsedLine.splice(fileUriEntryIndex, 1)
        } else if (stat.size > maxFileSize) {
          console.log('File too big, removing file uri')
          parsedLine.splice(fileUriEntryIndex, 1)
        } else {
          const file = fs.readFileSync(filePath).toString('base64')
          parsedLine[fileUriEntryIndex] = ['special-clipboard-share/file', file]

          // only send filename, not cross-os compatible otherwise
          parsedLine[parsedLine.findIndex((l) => l[0] === 'text/plain')] = [
            'text/plain',
            Buffer.from(path.basename(filePath)).toString('base64'),
          ]
        }
      }

      if (parsedLine.length === 0) {
        return
      }

      console.log('Sending clipboard')
      const encryptedData = encrypt(JSON.stringify(parsedLine))
      if (encryptedData.byteLength > 50 * 1024 * 1024) {
        // 50mb is the max size for the server
        console.error('Data too big, not sending.')
        return
      }
      ws.send(encryptedData, { binary: true })
    }
  })

  clipboardHandler.reader.on('error', (err) => {
    console.error(err)
  })

  ws.on('message', (encryptedData) => {
    const data = decrypt(encryptedData)

    // new clipboard enty, delete old temp file
    if (lastTempFileDir) {
      fs.rmdirSync(lastTempFileDir, { recursive: true })
      lastTempFileDir = null
    }

    // make sure we don't send this data back
    justSet = true
    setTimeout(() => {
      justSet = false
    }, 1000)

    const parsedLine = JSON.parse(data)

    // Find the index of the special clipboard share entry
    const specialClipboardShareIndex = parsedLine.findIndex(
      (entry) => entry[0] === 'special-clipboard-share/file',
    )

    // If a file entry exists, process it
    if (specialClipboardShareIndex >= 0) {
      const fileEntry = parsedLine[specialClipboardShareIndex]
      const fileContentBase64 = fileEntry[1]

      // Convert base64 to binary
      const fileBuffer = Buffer.from(fileContentBase64, 'base64')

      // Generate a temporary file path
      lastTempFileDir = path.join(
        os.tmpdir(),
        `clipboard-tempfiles`,
        Date.now().toString(),
      )
      fs.mkdirSync(lastTempFileDir, { recursive: true })
      const originalFilename = path.basename(
        Buffer.from(
          parsedLine.find((l) => l[0] === 'text/plain')[1],
          'base64',
        ).toString(),
      )
      const tempFilePath = path.join(lastTempFileDir, originalFilename)

      // Write the file to the temporary location
      fs.writeFileSync(tempFilePath, fileBuffer)

      // Update the parsedLine to point to the new file location
      const fileURL = pathToFileURL(tempFilePath).toString()
      parsedLine[specialClipboardShareIndex] = [
        'text/uri-list',
        Buffer.from(fileURL).toString('base64'),
      ]
    }

    clipboardHandler.write(JSON.stringify(parsedLine))
    console.log('Clipboard data received & set', parsedLine.length)
  })

  ws.on('close', () => {
    console.log('Server closed. Reconnecting...')
    setTimeout(start, 1000)
  })
}

let retries = 0
const maxRetries = 10
const start = () => {
  if (maxRetries !== -1 && retries >= maxRetries) {
    throw new Error('Could not connect')
  }
  retries += 1

  const ws = new WebSocket(config.server)

  ws.on('error', (err) => {
    console.error(err)
    console.log(`Retrying (${retries}/${maxRetries})`)
    setTimeout(start, retries * 1000)
  })

  ws.on('open', () => {
    console.log(`Connected to the server as ${keyHash}.`)
    retries = 0

    ws.send(`CON_HASH:${keyHash}`)

    initClient(ws)
  })
}

start()
