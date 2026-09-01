import fs from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import os from 'os'
import path from 'path'
import { parseArgs } from 'util'

import bytes from 'bytes'
import WebSocket from 'ws'
import ClipboardHandler from './lib/clipboard/index.mjs'

import createCryptoLib from './lib/crypto.mjs'

// Last-resort safety net: never let a stray throw in a callback take the
// whole daemon down. The handlers below (per-handler try/catch, subprocess
// error handling, reconnect) are the real fix; this just keeps us alive.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err)
})
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err)
})

const { values: args } = parseArgs({
  options: { config: { type: 'string', short: 'c' } },
  strict: true,
})
const configPath = args.config ?? './config.json'
const config = JSON.parse(fs.readFileSync(configPath).toString())
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

  // Kill this connection's helper subprocesses and drop their listeners when
  // the socket closes, so reconnecting doesn't leak a new pair of helpers.
  ws.on('close', () => {
    clipboardHandler.close()
  })

  clipboardHandler.reader.on('data', (line) => {
    if (justSet) return
    try {
      const parsedLine = JSON.parse(line)

      // new clipboard enty, delete old temp file
      if (lastTempFileDir) {
        fs.rmSync(lastTempFileDir, { recursive: true, force: true })
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

        let stat
        try {
          stat = fs.statSync(filePath)
        } catch (err) {
          console.error(err)
        }
        if (!stat) {
          console.log('Could not stat copied file')
          return
        }
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
          const textPlainIndex = parsedLine.findIndex(
            (l) => l[0] === 'text/plain',
          )
          if (textPlainIndex >= 0) {
            parsedLine[textPlainIndex] = [
              'text/plain',
              Buffer.from(path.basename(filePath)).toString('base64'),
            ]
          }
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
      try {
        ws.send(encryptedData, { binary: true })
      } catch (err) {
        console.error('Failed to send clipboard:', err.message)
      }
    } catch (err) {
      console.error('Error handling local clipboard change:', err)
    }
  })

  clipboardHandler.reader.on('error', (err) => {
    console.error(err)
  })

  ws.on('message', (encryptedData) => {
    try {
      const data = decrypt(encryptedData)

      // new clipboard enty, delete old temp file
      if (lastTempFileDir) {
        fs.rmSync(lastTempFileDir, { recursive: true, force: true })
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
        const textPlainEntry = parsedLine.find((l) => l[0] === 'text/plain')
        const originalFilename = textPlainEntry
          ? path.basename(Buffer.from(textPlainEntry[1], 'base64').toString())
          : `clipboard-file-${Date.now()}`
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
    } catch (err) {
      console.error('Error handling incoming clipboard message:', err)
    }
  })
}

// Reconnect forever with exponential backoff capped at 30s. A single failure
// can fire both 'error' and 'close'; the `reconnecting` guard makes sure that
// only schedules one reconnect (no reconnect storm / duplicate connections).
const baseBackoff = 1000
const maxBackoff = 30000
let backoff = baseBackoff
let reconnecting = false

const scheduleReconnect = () => {
  if (reconnecting) return
  reconnecting = true
  console.log(`Reconnecting in ${Math.round(backoff / 1000)}s...`)
  setTimeout(start, backoff)
  backoff = Math.min(maxBackoff, backoff * 2)
}

function start() {
  reconnecting = false
  const ws = new WebSocket(config.server)

  ws.on('error', (err) => {
    console.error('Connection error:', err.message)
  })

  ws.on('close', () => {
    console.log('Connection closed.')
    scheduleReconnect()
  })

  ws.on('open', () => {
    console.log(`Connected to the server as ${keyHash}.`)
    backoff = baseBackoff

    ws.send(`CON_HASH:${keyHash}`)

    initClient(ws)
  })
}

start()
