import fs from 'fs'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'url'
import os from 'os'
import path from 'path'
import { parseArgs } from 'util'

import bytes from 'bytes'
import WebSocket from 'ws'
import ClipboardHandler from './lib/clipboard/index.mjs'

import createCryptoLib from './lib/crypto.mjs'
import watchNetwork from './lib/networkWatcher.mjs'

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

// Connection liveness. A network switch or a suspend leaves a half-open TCP
// connection: no FIN/RST ever arrives, so 'close' never fires and the client
// would sit there "connected" but silent until the OS keepalive gives up
// (~2 hours). The heartbeat below is what actually notices.
const connectionConfig = config.connection ?? {}
const pingIntervalMs = connectionConfig.pingIntervalMs ?? 5000
const pongTimeoutMs = connectionConfig.pongTimeoutMs ?? 5000
const connectTimeoutMs = connectionConfig.connectTimeoutMs ?? 10000

// TLS is mandatory: the connection must be wss:// and the server's self-signed
// certificate must be pinned via config.serverCert. Refuse to run otherwise so
// clipboard traffic is never sent over an unauthenticated/plaintext channel.
if (!/^wss:\/\//i.test(config.server ?? '')) {
  console.error(
    `config.server must be a wss:// URL (got: ${config.server}). Plaintext ws:// is not allowed.`,
  )
  process.exit(1)
}
if (!config.serverCert) {
  console.error(
    'config.serverCert is required: path to the pinned server certificate (cert.pem).',
  )
  process.exit(1)
}
let serverCert
try {
  serverCert = fs.readFileSync(config.serverCert)
} catch (err) {
  console.error(
    `Could not read serverCert at ${config.serverCert}:`,
    err.message,
  )
  process.exit(1)
}

// Replay protection: reject messages whose timestamp is outside this window, or
// whose nonce we've already seen. Assumes machine clocks are within ~60s (NTP).
const REPLAY_WINDOW_MS = 60_000
const seenNonces = new Map() // nonce -> expiry timestamp (ms)

const pruneNonces = (now) => {
  for (const [nonce, expiry] of seenNonces) {
    if (expiry <= now) seenNonces.delete(nonce)
  }
}

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
      // Wrap in an authenticated envelope (timestamp + nonce) for replay
      // protection; GCM authenticates these fields along with the payload.
      const encryptedData = encrypt(
        JSON.stringify({
          t: Date.now(),
          n: crypto.randomUUID(),
          d: parsedLine,
        }),
      )
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
      const envelope = JSON.parse(data)

      // Replay protection: drop stale or already-seen messages.
      const now = Date.now()
      pruneNonces(now)
      if (
        typeof envelope.t !== 'number' ||
        Math.abs(now - envelope.t) > REPLAY_WINDOW_MS
      ) {
        console.error('Dropping message: timestamp outside allowed window')
        return
      }
      if (typeof envelope.n !== 'string' || seenNonces.has(envelope.n)) {
        console.error('Dropping message: replayed or missing nonce')
        return
      }
      seenNonces.set(envelope.n, envelope.t + REPLAY_WINDOW_MS)

      const parsedLine = envelope.d

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

// Reconnect forever with exponential backoff. A single failure can fire both
// 'error' and 'close'; the `reconnecting` guard makes sure that only schedules
// one reconnect (no reconnect storm / duplicate connections).
const baseBackoff = 1000
const maxBackoff = connectionConfig.maxBackoffMs ?? 10000
let backoff = baseBackoff
let reconnecting = false
let reconnectTimer = null
let currentWs = null

const scheduleReconnect = () => {
  if (reconnecting) return
  reconnecting = true
  // Jitter (50-100% of the backoff) so clients that all lost the same network
  // don't come back in lockstep.
  const delay = Math.round(backoff * (0.5 + Math.random() * 0.5))
  console.log(`Reconnecting in ${(delay / 1000).toFixed(1)}s...`)
  reconnectTimer = setTimeout(start, delay)
  backoff = Math.min(maxBackoff, backoff * 2)
}

function start() {
  reconnecting = false
  reconnectTimer = null
  // Pin the server's self-signed certificate: the client trusts only this cert
  // (encryption + server authentication, no public CA). handshakeTimeout keeps
  // a connect attempt on a black-holed network from hanging on OS-level SYN
  // retries (~75s) before it gives up.
  const ws = new WebSocket(config.server, {
    ca: [serverCert],
    handshakeTimeout: connectTimeoutMs,
  })
  currentWs = ws

  let pingTimer = null
  let pongTimer = null

  const stopHeartbeat = () => {
    clearInterval(pingTimer)
    clearTimeout(pongTimer)
    pingTimer = null
    pongTimer = null
  }

  // Any inbound traffic proves the link is still there, not just pongs.
  const markAlive = () => {
    clearTimeout(pongTimer)
    pongTimer = null
  }
  ws.on('pong', markAlive)
  ws.on('message', markAlive)

  ws.on('error', (err) => {
    console.error('Connection error:', err.message)
  })

  ws.on('close', () => {
    console.log('Connection closed.')
    stopHeartbeat()
    if (currentWs === ws) currentWs = null
    scheduleReconnect()
  })

  ws.on('open', () => {
    console.log(`Connected to the server as ${keyHash}.`)
    backoff = baseBackoff

    // Heartbeat: ping regularly and tear the socket down if the pong doesn't
    // come back. terminate() rather than close(), because close() waits for a
    // close frame that a dead link is never going to deliver.
    pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (pongTimer) return // still waiting on the previous ping
      ws.ping()
      pongTimer = setTimeout(() => {
        console.error(
          `No pong within ${pongTimeoutMs}ms, connection is dead. Terminating.`,
        )
        ws.terminate()
      }, pongTimeoutMs)
    }, pingIntervalMs)

    ws.send(`CON_HASH:${keyHash}`)

    initClient(ws)
  })
}

// A new IP or a resume from suspend almost always means the current socket is
// already dead. Don't wait for the ping to time out: drop it and reconnect at
// the base backoff, which also gives a freshly-up interface a moment to settle.
watchNetwork((reason) => {
  console.log(`Detected ${reason}, forcing reconnect.`)
  backoff = baseBackoff
  if (currentWs) {
    // 'close' fires immediately and schedules the reconnect.
    currentWs.terminate()
  } else if (reconnecting) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
    reconnecting = false
    start()
  }
})

start()
