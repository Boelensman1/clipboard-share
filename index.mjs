import fs from 'fs'
import WebSocket from 'ws'
import ClipboardHandler from './lib/clipboard/index.mjs'

import createCryptoLib from './lib/crypto.mjs'

const config = JSON.parse(fs.readFileSync('./config.json').toString())
const { encrypt, decrypt } = createCryptoLib(Buffer.from(config.key, 'base64'))

let justSet = false

const initClient = (ws) => {
  const clipboardHandler = new ClipboardHandler()

  clipboardHandler.reader.on('data', (line) => {
    if (!justSet) {
      console.log('Sending clipboard')
      ws.send(encrypt(line), { binary: true })
    }
  })

  clipboardHandler.reader.on('error', (err) => {
    console.error(err)
  })

  ws.on('message', (encryptedData) => {
    const data = decrypt(encryptedData)

    // make sure we don't send this data back
    justSet = true
    setTimeout(() => {
      justSet = false
    }, 1000)

    clipboardHandler.write(data)
    console.log('Clipboard data received & set')
  })

  ws.on('close', () => {
    console.log('Server closed. Reconnecting...')
    setTimeout(start, 1000)
  })
}

let retries = 0
const maxRetries = 5
const start = () => {
  if (maxRetries !== -1 && retries >= maxRetries) {
    throw new Error('Could not connect')
  }
  retries += 1

  const ws = new WebSocket(config.server)

  ws.on('error', (err) => {
    console.error(err)
    console.log(`Retrying (${retries}/${maxRetries})`)
    setTimeout(start, 1000)
  })

  ws.on('open', () => {
    console.log('Connected to the server.')
    retries = 0
    initClient(ws)
  })
}

start()
