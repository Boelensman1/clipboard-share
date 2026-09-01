#!/usr/bin/env node
import fs from 'fs'
import net from 'net'
import path from 'path'
import { spawnSync } from 'child_process'
import { parseArgs } from 'util'

// Generates a self-signed certificate/key pair for the clipboard-share server.
// The client pins this cert (config.serverCert), so it doesn't need a public CA;
// the SAN must match the host/IP clients put in their `server` wss:// URL.
//
// Usage: node gen-cert.mjs <host-or-ip> [outDir] [--force]

const { values, positionals } = parseArgs({
  options: { force: { type: 'boolean', default: false } },
  allowPositionals: true,
  strict: true,
})

const host = positionals[0]
const outDir = positionals[1] ?? '.'

if (!host) {
  console.error('Usage: node gen-cert.mjs <host-or-ip> [outDir] [--force]')
  process.exit(1)
}

const certPath = path.join(outDir, 'cert.pem')
const keyPath = path.join(outDir, 'key.pem')

for (const p of [certPath, keyPath]) {
  if (fs.existsSync(p) && !values.force) {
    console.error(`${p} already exists. Pass --force to overwrite.`)
    process.exit(1)
  }
}

// net.isIP returns 4 or 6 for IP addresses, 0 for hostnames.
const san = net.isIP(host) ? `IP:${host}` : `DNS:${host}`

const result = spawnSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:4096',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '3650',
    '-subj',
    `/CN=${host}`,
    '-addext',
    `subjectAltName=${san}`,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.error(
      'openssl not found on PATH. Please install openssl and retry.',
    )
  } else {
    console.error('Failed to run openssl:', result.error.message)
  }
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`openssl exited with status ${result.status}`)
  process.exit(result.status ?? 1)
}

console.log(`\nGenerated:\n  ${certPath}\n  ${keyPath}\n`)
console.log('Next steps:')
console.log(`  1. Run the server with TLS:`)
console.log(`       node server.mjs --cert ${certPath} --key ${keyPath}`)
console.log(`     (keep key.pem on the server only — it is the private key)`)
console.log(`  2. Copy cert.pem to each client and set it in their config:`)
console.log(`       "server": "wss://${host}:8080",`)
console.log(`       "serverCert": "./cert.pem"`)
