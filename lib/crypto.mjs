import crypto from 'crypto'

const createCryptoLib = (key) => {
  const encrypt = (text) => {
    const iv = crypto.randomBytes(16)
    let cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    let encrypted = cipher.update(text)
    return Buffer.concat([iv, encrypted, cipher.final()])
  }

  const decrypt = (data) => {
    const iv = data.slice(0, 16)
    const encryptedData = data.slice(16)

    let encryptedText = Buffer.from(encryptedData, 'hex')
    let decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    let decrypted = decipher.update(encryptedText)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    return decrypted.toString()
  }

  return { encrypt, decrypt }
}

export default createCryptoLib
