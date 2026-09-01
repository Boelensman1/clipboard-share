#!/usr/bin/env pwsh
# Build the Windows clipboard helper into windows-clipboard/bin/clipboard.exe.
# Requires the .NET SDK (https://dotnet.microsoft.com/download). This can also be
# cross-built from Linux/macOS — the produced binary is a win-x64 executable.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
dotnet publish "$here/Clipboard.csproj" `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -o "$here/bin"
