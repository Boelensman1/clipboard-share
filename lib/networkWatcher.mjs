import os from 'os'

// Poll interval for both checks below. Cheap enough to run often:
// os.networkInterfaces() is a single syscall.
const DEFAULT_TICK_MS = 2000

// How much later than expected a tick has to fire before we conclude the
// machine was suspended rather than just busy.
const DEFAULT_WAKE_SLACK_MS = 5000

// Only routable addresses count. Link-local ones (IPv6 fe80::, IPv4 169.254/16)
// say nothing about whether we can reach the server, and they churn constantly
// on macOS -- AirDrop's awdl0/llw0 come and go, unconfigured NICs pick up new
// self-assigned addresses -- which would otherwise cause reconnect storms.
const isRoutable = (address) => {
  if (address.internal) return false
  if (address.family === 'IPv6')
    return !/^fe[89ab][0-9a-f]:/i.test(address.address)
  return !address.address.startsWith('169.254.')
}

const interfaceSignature = () =>
  Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses ?? [])
        .filter(isRoutable)
        .map((address) => `${name}:${address.family}:${address.address}`),
    )
    .sort()
    .join(',')

// Watch for the two local events that typically leave a half-open socket
// behind: the set of non-internal IPs changing (wifi <-> ethernet, VPN up or
// down, a new DHCP lease) and the process resuming after a suspend. Calls
// onChange(reason) for each; the initial state is only seeded, never reported.
// Returns a function that stops watching. The timings are only overridden by
// the tests, which can't wait seconds per assertion.
const watchNetwork = (onChange, options = {}) => {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS
  const wakeSlackMs = options.wakeSlackMs ?? DEFAULT_WAKE_SLACK_MS

  let signature = interfaceSignature()
  let lastTick = Date.now()

  const timer = setInterval(() => {
    const now = Date.now()
    const elapsed = now - lastTick
    lastTick = now

    // A tick that arrives far too late means the whole process was frozen:
    // suspend/resume, or SIGSTOP/SIGCONT.
    if (elapsed > tickMs + wakeSlackMs) {
      signature = interfaceSignature()
      onChange(`wake after ${Math.round(elapsed / 1000)}s asleep`)
      return
    }

    const current = interfaceSignature()
    if (current !== signature) {
      signature = current
      onChange('network interface change')
    }
  }, tickMs)

  return () => clearInterval(timer)
}

export default watchNetwork
