## Config

```{
"server": "ws://serverlocation",
"key": "key, base64 encoded",
"key": "salt, base64 encoded",
"maxFileSize": "5mb" # max 32mb
}
```

Key can be generated using `openssl rand -base64 32` (must be this size)
Salt can be generated using `openssl rand -base64 18` (can be longer)

The client reads `./config.json` by default. Pass `--config <path>` (or `-c`) to point it at a file elsewhere.
