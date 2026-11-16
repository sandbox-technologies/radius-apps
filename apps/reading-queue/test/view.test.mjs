import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../bundle/ui/app.js', import.meta.url), 'utf8')
const clone = value => JSON.parse(JSON.stringify(value))

// A deliberately tiny DOM/SDK double. node:vm is NOT a security sandbox.
class Element {
  value = ''
  textContent = ''
  hidden = false
  disabled = false
  children = []
  listeners = new Map()
  append(...nodes) { this.children.push(...nodes) }
  replaceChildren(...nodes) { this.children = nodes }
  addEventListener(name, callback) { this.listeners.set(name, callback) }
  reset() {}
}

async function settled(condition) {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(condition(), 'mock view did not settle')
}

function openMockView({ bridge = true, failure } = {}) {
  const selectors = ['#status', '#items', '#revision', '#empty', '#refresh', '#save', '#context', '#add-form', '#save-form', '#page-title', '#page-url']
  const elements = Object.fromEntries(selectors.map(selector => [selector, new Element()]))
  const buttons = [elements['#refresh'], elements['#save']]
  const listeners = new Map()
  const timers = new Map()
  const calls = []
  const runs = new Map()
  let pages = [{ title: '<img src=x onerror=alert(1)>', url: 'javascript:untrusted-text-only' }]
  let revision = 1
  let sequence = 0
  let pending = { events: [], gap: false }
  let eventError
  let nextTimer = 0
  const sdk = {
    async describe() { return {} },
    async invoke(action, input, options) {
      calls.push(clone({ action, input, options }))
      const id = `run_${calls.length}`
      if (action === 'add' && !failure) { pages.push(clone(input)); revision++ }
      if (action === 'addSelectedPage' && !failure) { pages.push({ title: 'Captured', url: 'https://example.net' }); revision++ }
      const result = action === 'list' ? { revision, items: clone(pages) } : { revision }
      runs.set(id, failure ? { id, status: 'failed', error: { code: 'EFFECT_UNKNOWN', message: failure } } : { id, status: 'succeeded', result })
      return { id, status: 'queued' }
    },
    async getRun(id) { assert.ok(runs.has(id)); return runs.get(id) },
    async events(after) {
      assert.equal(after, sequence)
      if (eventError) throw eventError
      const batch = { sequence: ++sequence, ...pending }
      pending = { events: [], gap: false }
      return batch
    },
  }
  const document = {
    visibilityState: 'visible',
    querySelector: selector => elements[selector],
    querySelectorAll: () => buttons,
    createElement: () => new Element(),
  }
  runInNewContext(source, {
    window: { ...(bridge ? { radiusApp: sdk } : {}), addEventListener: (name, callback) => listeners.set(name, callback) },
    document,
    setTimeout(callback, delay) {
      assert.equal(delay, 2000, 'all mocked runs complete immediately; only event polling should schedule')
      const id = ++nextTimer
      timers.set(id, callback)
      return id
    },
    clearTimeout: id => timers.delete(id),
  })
  return {
    elements, buttons, calls, timers, document,
    async ready() { await settled(() => bridge ? timers.size > 0 : elements['#status'].textContent.includes('no app bridge')) },
    async submit(selector) {
      elements[selector].listeners.get('submit')({ preventDefault() {} })
      await settled(() => buttons.every(button => !button.disabled))
    },
    async poll() {
      assert.equal(timers.size, 1)
      const [id, callback] = timers.entries().next().value
      timers.delete(id)
      await callback()
    },
    externalWrite({ gap = false } = {}) {
      pages.push({ title: 'Saved elsewhere', url: 'https://example.org' })
      revision++
      pending = { gap, events: gap ? [] : [{ name: 'app.changed', payload: { revision } }] }
    },
    revoke() { eventError = Object.assign(new Error('Mock view revoked'), { code: 'PERMISSION_DENIED' }) },
    close() { listeners.get('pagehide')() },
  }
}

test('view consumes admitted run receipts and renders metadata as text', async () => {
  const view = openMockView()
  await view.ready()
  assert.deepEqual(view.calls, [{ action: 'list', input: {}, options: {} }])
  const row = view.elements['#items'].children[0]
  assert.equal(row.children[0].textContent, '<img src=x onerror=alert(1)>')
  assert.equal(row.children[1].textContent, 'javascript:untrusted-text-only')
  assert.equal(view.elements['#empty'].hidden, true)
  assert.match(view.elements['#revision'].textContent, /Revision 1/)
  view.close()
  assert.equal(view.timers.size, 0)
})

test('view direct-entry and captured-handle forms call only the document SDK', async () => {
  const view = openMockView()
  await view.ready()
  view.elements['#page-title'].value = 'Entered title'
  view.elements['#page-url'].value = '  https://example.com  '
  await view.submit('#add-form')
  assert.deepEqual(view.calls.find(call => call.action === 'add'), {
    action: 'add', input: { title: 'Entered title', url: 'https://example.com' }, options: {},
  })
  view.elements['#context'].value = 'context_mock_view_caller'
  await view.submit('#save-form')
  assert.deepEqual(view.calls.find(call => call.action === 'addSelectedPage'), {
    action: 'addSelectedPage', input: {}, options: { contextHandle: 'context_mock_view_caller' },
  })
  assert.equal(view.elements['#context'].value, '')
  assert.equal(view.elements['#items'].children.length, 3)
  view.close()
})

test('events and gaps resynchronize state; hidden views do not poll the SDK', async () => {
  const view = openMockView()
  await view.ready()
  view.externalWrite()
  await view.poll()
  assert.equal(view.elements['#items'].children.length, 2)
  view.externalWrite({ gap: true })
  view.document.visibilityState = 'hidden'
  await view.poll()
  assert.equal(view.elements['#items'].children.length, 2)
  view.document.visibilityState = 'visible'
  await view.poll()
  assert.equal(view.elements['#items'].children.length, 3)
  view.close()
})

test('revoked event bridge reports the error and stops polling', async () => {
  const view = openMockView()
  await view.ready()
  view.revoke()
  await view.poll()
  assert.match(view.elements['#status'].textContent, /PERMISSION_DENIED: Mock view revoked/)
  assert.equal(view.timers.size, 0)
  view.close()
})

test('failed run tells the user to inspect effects without automatic invocation retry', async () => {
  const view = openMockView({ failure: 'Mock ambiguous effect' })
  await view.ready()
  assert.match(view.elements['#status'].textContent, /EFFECT_UNKNOWN/)
  assert.match(view.elements['#status'].textContent, /Inspect run_1 before retrying; effects may have committed/)
  assert.equal(view.calls.length, 1)
  view.close()
})

test('an ordinary browser receives a missing-bridge error, not fabricated data', async () => {
  const view = openMockView({ bridge: false })
  await view.ready()
  assert.ok(view.buttons.every(button => button.disabled))
  assert.equal(view.elements['#items'].children.length, 0)
  assert.equal(view.calls.length, 0)
  assert.equal(view.timers.size, 0)
})

test('view source avoids privileged APIs and uses the shared accessible motion token', async () => {
  assert.doesNotMatch(source, /innerHTML|localStorage|ipcRenderer|fetch\(|window\.api|window\.electron/)
  const css = await readFile(new URL('../bundle/ui/styles.css', import.meta.url), 'utf8')
  assert.match(css, /--interaction-duration: 80ms/)
  assert.match(css, /transition: background-color var\(--interaction-duration\)/)
  assert.match(css, /prefers-reduced-motion: reduce/)
})
