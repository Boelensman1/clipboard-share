import WebSocket, { WebSocketServer } from 'ws'

// Create a WebSocket server on port 8080
const wss = new WebSocketServer({ port: 8080 })

wss.on('connection', function connection(ws) {
  console.log('A new client connected.')

  // Receiving message from client
  ws.on('message', function incoming(message) {
    console.log('received a clipboard')
    // Broadcast the message to all other clients except the sender
    wss.clients.forEach(function each(client) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message, { binary: true })
      }
    })
  })
})

console.log('WebSocket server is running on ws://localhost:8080')
