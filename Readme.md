## Config

```{
"server": "wss://serverlocation:8080",
"key": "key, base64 encoded",
"salt": "salt, base64 encoded",
"serverCert": "./cert.pem",
"maxFileSize": "5mb" # max 32mb
}
```

Key can be generated using `openssl rand -base64 32` (must be this size)
Salt can be generated using `openssl rand -base64 18` (can be longer)

The client reads `./config.json` by default. Pass `--config <path>` (or `-c`) to point it at a file elsewhere.

## Security / TLS

Transport is encrypted with TLS and is **mandatory** — the server only speaks
`wss://` and the client refuses to connect over plaintext `ws://`. The server uses a
self-signed certificate that each client pins via `serverCert` (so no public CA is
needed). Payloads are additionally end-to-end encrypted with AES-256-GCM and carry a
timestamp + nonce for replay protection.

Generate a certificate/key pair (the SAN must match the host/IP clients use in `server`):

```
pnpm gen-cert <host-or-ip>          # or: node gen-cert.mjs <host-or-ip> [outDir]
```

This writes `cert.pem` and `key.pem`. Then:

1. Run the server with TLS (both flags required):
   ```
   node server.mjs --cert cert.pem --key key.pem
   ```
   Keep `key.pem` on the server only — it is the private key.
2. Copy `cert.pem` (public) to each client and point `serverCert` at it in the config.

> Replay protection compares message timestamps against the receiver's clock with a
> 60-second window, so keep machine clocks roughly in sync (NTP is enough).
