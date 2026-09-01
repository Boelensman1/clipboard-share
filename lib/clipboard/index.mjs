import os from 'os'

import createMacOsClipboardReader from './macos/clipboardReader.mjs'
import createMacOsClipboardWriter from './macos/clipboardWriter.mjs'

import createLinuxClipboardReader from './linux/clipboardReader.mjs'
import createLinuxClipboardWriter from './linux/clipboardWriter.mjs'

import createWindowsClipboardReader from './windows/clipboardReader.mjs'
import createWindowsClipboardWriter from './windows/clipboardWriter.mjs'

class Clipboard {
  constructor() {
    switch (os.platform()) {
      case 'darwin':
        this.reader = createMacOsClipboardReader()
        this.write = createMacOsClipboardWriter()
        return
      case 'linux':
        this.reader = createLinuxClipboardReader()
        this.write = createLinuxClipboardWriter()
        return
      case 'win32':
        this.reader = createWindowsClipboardReader()
        this.write = createWindowsClipboardWriter()
        return
      default:
        throw new Error(`Platform "${os.platform()}" not supported!`)
    }
  }

  // Stop both helper subprocesses and drop their listeners. Called on
  // reconnect so we don't leak a new pair of helpers each time.
  close() {
    this.reader?.destroy?.()
    this.write?.stop?.()
  }
}

export default Clipboard
