import os from 'os'

import createMacOsClipboardReader from './macos/clipboardReader.mjs'
import createMacOsClipboardWriter from './macos/clipboardWriter.mjs'

import createLinuxClipboardReader from './linux/clipboardReader.mjs'
import createLinuxClipboardWriter from './linux/clipboardWriter.mjs'

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
      default:
        throw new Error(`Platform "${os.platform()}" not supported!`)
    }
  }
}

export default Clipboard
