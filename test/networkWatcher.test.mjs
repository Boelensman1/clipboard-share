import assert from 'node:assert/strict'
import os from 'node:os'
import test from 'node:test'

import watchNetwork from '../lib/networkWatcher.mjs'

// Fast timings so a test doesn't take seconds per assertion.
const tickMs = 20
const wakeSlackMs = 100

const realNetworkInterfaces = os.networkInterfaces

const ipv4 = (address) => ({ address, family: 'IPv4', internal: false })
const ipv6 = (address) => ({ address, family: 'IPv6', internal: false })

// A plausible macOS interface table: loopback, a wifi NIC with a routable
// address plus its link-local, AirDrop (link-local only), and an unplugged NIC
// that self-assigned an APIPA address.
const baseInterfaces = () => ({
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  en0: [ipv4('10.0.180.48'), ipv6('fe80::4e1:7f05:5634:9a6e')],
  awdl0: [ipv6('fe80::7cb2:f1ff:fe4e:6492')],
  en8: [ipv4('169.254.24.62')],
})

const settle = () => new Promise((resolve) => setTimeout(resolve, tickMs * 4))

// Runs `body` with os.networkInterfaces() stubbed and a watcher attached.
// `set` swaps in a new interface table and waits for the watcher to notice it.
const withWatcher = async (body) => {
  let interfaces = baseInterfaces()
  const reasons = []

  os.networkInterfaces = () => interfaces
  const stop = watchNetwork((reason) => reasons.push(reason), {
    tickMs,
    wakeSlackMs,
  })

  try {
    await body({
      reasons,
      set: async (changes) => {
        interfaces = { ...interfaces, ...changes }
        await settle()
      },
    })
  } finally {
    stop()
    os.networkInterfaces = realNetworkInterfaces
  }
}

test('does not report the state it started with', async () => {
  await withWatcher(async ({ reasons }) => {
    await settle()
    assert.deepEqual(reasons, [])
  })
})

test('ignores link-local churn', async () => {
  await withWatcher(async ({ reasons, set }) => {
    // macOS rotates awdl0/llw0's MAC-derived address every ~14s, and an
    // unconfigured NIC re-rolls its 169.254 address. Neither says anything
    // about whether the server is reachable, so neither may force a reconnect.
    await set({ awdl0: [ipv6('fe80::d872:8dff:fe64:7d7')] })
    await set({ en8: [ipv4('169.254.99.1')] })
    await set({ llw0: [ipv6('fe80::d872:8dff:fe64:7d7')] })
    assert.deepEqual(reasons, [])
  })
})

test('reports a new DHCP lease on a routable interface', async () => {
  await withWatcher(async ({ reasons, set }) => {
    await set({ en0: [ipv4('192.168.1.20'), ipv6('fe80::4e1:7f05:5634:9a6e')] })
    assert.deepEqual(reasons, ['network interface change'])
  })
})

test('reports a VPN going up and coming back down', async () => {
  await withWatcher(async ({ reasons, set }) => {
    await set({ utun6: [ipv4('10.252.1.7')] })
    await set({ utun6: [] })
    assert.deepEqual(reasons, [
      'network interface change',
      'network interface change',
    ])
  })
})

test('reports losing every routable address', async () => {
  await withWatcher(async ({ reasons, set }) => {
    // Wifi switched off: only link-local addresses are left.
    await set({ en0: [ipv6('fe80::4e1:7f05:5634:9a6e')] })
    assert.deepEqual(reasons, ['network interface change'])
  })
})

test('reports a wake when the process was frozen', async () => {
  await withWatcher(async ({ reasons }) => {
    // Block the event loop the way a suspend (or SIGSTOP) would, so the next
    // tick fires far later than it was scheduled for.
    const until = Date.now() + tickMs + wakeSlackMs + 50
    while (Date.now() < until) {
      // busy wait
    }
    await settle()

    assert.equal(reasons.length, 1)
    assert.match(reasons[0], /^wake after \d+s asleep$/)
  })
})

test('stops reporting once stopped', async () => {
  let interfaces = baseInterfaces()
  const reasons = []

  os.networkInterfaces = () => interfaces
  const stop = watchNetwork((reason) => reasons.push(reason), {
    tickMs,
    wakeSlackMs,
  })

  try {
    stop()
    interfaces = { ...interfaces, en0: [ipv4('192.168.1.20')] }
    await settle()
    assert.deepEqual(reasons, [])
  } finally {
    os.networkInterfaces = realNetworkInterfaces
  }
})
