import crypto from 'crypto'

// Wire format (all binary, concatenated):
//   version(1) || iv(12) || authTag(16) || ciphertext
// AES-256-GCM gives us authenticated encryption: decrypt() throws if the
// ciphertext (or iv/tag/version) was tampered with, so a malicious relay or
// MITM can't silently alter the clipboard. The version byte lets us evolve
// the format and lets decrypt reject old/foreign messages cleanly.
const VERSION = 0x01
const IV_LENGTH = 12
const TAG_LENGTH = 16

const createCryptoLib = (key, salt) => {
  const encrypt = (text) => {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()
    return Buffer.concat([Buffer.from([VERSION]), iv, authTag, ciphertext])
  }

  const decrypt = (data) => {
    if (data.length < 1 + IV_LENGTH + TAG_LENGTH) {
      throw new Error('Ciphertext too short')
    }
    if (data[0] !== VERSION) {
      throw new Error(`Unsupported message version: ${data[0]}`)
    }
    const iv = data.subarray(1, 1 + IV_LENGTH)
    const authTag = data.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH)
    const ciphertext = data.subarray(1 + IV_LENGTH + TAG_LENGTH)

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    // final() throws if authentication fails (tampered / wrong key).
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  }

  const getKeyHash = () => {
    return crypto.scryptSync(key, salt, 16).toString('hex')
  }

  return { encrypt, decrypt, getKeyHash }
}

export default createCryptoLib
