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

## Clients

The client is the same `node index.mjs` on every OS; only the native clipboard
helper it shells out to differs. Text, PNG images, and small files are synced on
all platforms.

- **Linux** — Python + GTK helpers in `linux-clipboard/` (needs PyGObject / GTK).
- **macOS** — a Swift `pbv` binary; build it with `make -C macos-pasteboard`.
- **Windows** — a C# helper (`windows-clipboard/`). Build the `clipboard.exe` once
  with the .NET SDK, then run the client normally:

  ```
  pnpm build:windows          # -> windows-clipboard/bin/clipboard.exe
  node index.mjs -c config.json
  ```

  `build:windows` runs `dotnet publish` and can be cross-built from Linux/macOS
  (it targets `win-x64`), or on Windows directly via `windows-clipboard/build.ps1`.
  A Windows **client** only needs the pinned `cert.pem` in its config — `openssl`
  is only required on the server when generating the certificate (see below).

  ### Autostart at logon (Windows)

  To have the client start automatically, run this once from a **normal
  (non-admin) PowerShell** as the user who will be logged in — after building
  the helper (`pnpm build:windows`) and creating a working `config.json`:

  ```
  windows-clipboard\autostart.ps1                 # install
  windows-clipboard\autostart.ps1 -Uninstall      # remove
  ```

  It registers a per-user Scheduled Task that launches the client **at each
  logon**, hidden (no console window), and restarts it if it exits. Output is
  logged to `%LOCALAPPDATA%\clipboard-share\client.log`. Use `-Config <path>` if
  your config lives outside the repo. Because the clipboard APIs need an
  interactive desktop, this starts at logon — not before login as a service.

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
