import fs from 'fs'
import https from 'https'
import { parseArgs } from 'util'

import WebSocket, { WebSocketServer } from 'ws'

const port = 8080

// TLS is mandatory: the server only speaks wss://. Both --cert and --key are
// required so clipboard traffic is never relayed over a plaintext channel.
const { values: args } = parseArgs({
  options: {
    cert: { type: 'string' },
    key: { type: 'string' },
  },
  strict: true,
})

if (!args.cert || !args.key) {
  console.error(
    'Both --cert <path> and --key <path> are required (TLS is mandatory). ' +
      'Generate a self-signed pair with: node gen-cert.mjs <host-or-ip>',
  )
  process.exit(1)
}

let cert
let key
try {
  cert = fs.readFileSync(args.cert)
  key = fs.readFileSync(args.key)
} catch (err) {
  console.error('Could not read cert/key:', err.message)
  process.exit(1)
}

const httpsServer = https.createServer({ cert, key })

const wss = new WebSocketServer({
  server: httpsServer,
  maxPayload: 50 * 1024 * 1024, // 50mb, max filesize is 32mb, but there is some overhead from base64 encoding
})

const clientHashes = new Map()

const broadcastMessage = (senderWs, message) => {
  const senderHash = clientHashes.get(senderWs)
  wss.clients.forEach(function each(client) {
    if (client !== senderWs && client.readyState === WebSocket.OPEN) {
      const clientHash = clientHashes.get(client)
      if (clientHash === senderHash) {
        // Broadcast to clients with matching hash values
        client.send(message, { binary: true })
      }
    }
  })
}

const hashPrefix = Buffer.from('CON_HASH:')

// Check if the message starts with the same bytes as 'HASH:'
const isHashMessage = (message) =>
  message.length >= hashPrefix.length &&
  message.slice(0, hashPrefix.length).equals(hashPrefix)

wss.on('connection', (ws) => {
  console.log('A new client connected.')

  // Receiving message from client
  ws.on('message', (message) => {
    // Check if the message is a hash connection message
    if (isHashMessage(message)) {
      console.log('Received a hash')

      const hashValue = message.toString().substring('CON_HASH:'.length)
      clientHashes.set(ws, hashValue)
    } else {
      console.log('Received a clipboard')

      broadcastMessage(ws, message)
    }
  })

  ws.on('close', () => {
    console.log('A client disconnected.')
    // Remove client from clientHashes map on disconnect
    clientHashes.delete(ws)
  })
})

httpsServer.listen(port, () => {
  console.log(`WebSocket server is running on wss://localhost:${port}`)
})
