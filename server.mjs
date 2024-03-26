import WebSocket, { WebSocketServer } from 'ws'

const port = 8080

const wss = new WebSocketServer({
  port,
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

console.log(`WebSocket server is running on ws://localhost:${port}`)
