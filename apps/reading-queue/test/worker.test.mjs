import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseAppJson, parseAppManifest, validateAppValue } from '@radius/apps-sdk'
import { appBundleDigest, validateAppBundleFiles } from '@radius/apps-sdk/release'
import { add, addSelectedPage, list } from '../bundle/worker.js'

const manifest = parseAppManifest(parseAppJson(await readFile(new URL('../bundle/radius-app.json', import.meta.url), 'utf8')))

// A local test double, NOT the native permission broker or a security sandbox.
function localHost({ value = null, revision = 0, page, failAt } = {}) {
  let state = structuredClone(value)
  const calls = []
  const context = { host: { async call(method, input) {
    calls.push({ method, input: structuredClone(input) })
    if (method === failAt) throw Object.assign(new Error(`Mock failure: ${method}`), {
      code: method === 'storage.compareAndSet' ? 'REVISION_CONFLICT' : 'CAPABILITY_UNAVAILABLE',
    })
    if (method === 'storage.read') {
      assert.deepEqual(input, {})
      return { revision, value: structuredClone(state) }
    }
    if (method === 'storage.compareAndSet') {
      if (input.expectedRevision !== revision) throw Object.assign(new Error('Mock stale write'), { code: 'REVISION_CONFLICT' })
      state = structuredClone(input.value)
      return { revision: ++revision }
    }
    if (method === 'tabs.read') {
      assert.deepEqual(input, {}, 'worker does not send a tab ID or a focused-target selector')
      assert.ok(page, 'this test did not supply captured metadata')
      return structuredClone(page)
    }
    if (method === 'events.emit') {
      assert.deepEqual(input, { name: 'changed', payload: { revision } })
      validateAppValue(manifest.provides.events.changed.payloadSchema, input.payload)
      return null
    }
    throw new Error(`Unexpected host method: ${method}`)
  } } }
  return { context, calls, snapshot: () => ({ revision, value: structuredClone(state) }) }
}

test('Reading Queue bundle validates through the public SDK', async () => {
  const paths = ['radius-app.json', 'worker.js', 'ui/index.html', 'ui/app.js', 'ui/styles.css']
  const files = Object.fromEntries(await Promise.all(paths.map(async path => [path,
    (await readFile(new URL(`../bundle/${path}`, import.meta.url))).toString('base64'),
  ])))
  const bundle = validateAppBundleFiles(files)
  assert.equal(bundle.manifest.id, 'dev.radius.reading-queue')
  assert.equal(bundle.manifest.version, '1.0.0')
  assert.equal(bundle.digest, appBundleDigest(files))
  assert.equal(bundle.manifest.instances.mode, 'multiple')
  assert.deepEqual(bundle.manifest.provides.triggers, {})
  assert.deepEqual(bundle.manifest.provides.actions.add.requires, ['queueState'])
  assert.deepEqual(bundle.manifest.provides.actions.addSelectedPage.requires, ['queueState', 'selectedPage'])
  assert.deepEqual(bundle.manifest.requires.selectedPage.scope, { target: 'invocation', fields: ['title', 'url'] })
})

test('direct add/list share revisioned host state without reading a tab', async () => {
  const host = localHost()
  assert.deepEqual(await list({}, host.context), { revision: 0, items: [] })
  const page = { title: '<script>untrusted text</script>', url: 'https://example.com/article' }
  validateAppValue(manifest.provides.actions.add.inputSchema, page)
  const result = await add(page, host.context)
  validateAppValue(manifest.provides.actions.add.outputSchema, result)
  assert.deepEqual(result, { revision: 1 })
  assert.deepEqual(host.calls.slice(-3).map(call => call.method), ['storage.read', 'storage.compareAndSet', 'events.emit'])
  assert.equal(host.calls.some(call => call.method === 'tabs.read'), false)
  const saved = await list({}, host.context)
  validateAppValue(manifest.provides.actions.list.outputSchema, saved)
  assert.deepEqual(saved, { revision: 1, items: [page] })
  saved.items[0].title = 'changed in the caller'
  assert.equal((await list({}, host.context)).items[0].title, page.title)
})

test('captured-page action uses only host-provided metadata, never an ambient target', async () => {
  const page = { title: 'Captured page', url: 'https://example.org' }
  const host = localHost({ page })
  assert.deepEqual(await addSelectedPage({}, host.context), { revision: 1 })
  assert.deepEqual(host.calls.map(call => call.method), ['tabs.read', 'storage.read', 'storage.compareAndSet', 'events.emit'])
  assert.deepEqual((await list({}, host.context)).items, [page])
})

test('separate host-owned instances do not share a module-global queue', async () => {
  const first = localHost()
  const second = localHost()
  await add({ title: 'Private', url: 'https://example.com' }, first.context)
  assert.deepEqual(await list({}, second.context), { revision: 0, items: [] })
  assert.equal((await list({}, first.context)).items.length, 1)
})

test('concurrent writers make one commit and one conflict without replay', async () => {
  const host = localHost()
  const results = await Promise.allSettled([
    add({ title: 'One', url: 'https://example.com/1' }, host.context),
    add({ title: 'Two', url: 'https://example.com/2' }, host.context),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'REVISION_CONFLICT')
  assert.equal(host.snapshot().revision, 1)
  assert.equal(host.snapshot().value.items.length, 1)
  assert.equal(host.calls.filter(call => call.method === 'events.emit').length, 1)
  assert.equal(host.calls.filter(call => call.method === 'storage.compareAndSet').length, 2)
})

test('event failure surfaces after commit without retrying or pretending to roll back', async () => {
  const host = localHost({ failAt: 'events.emit' })
  await assert.rejects(add({ title: 'Saved once', url: 'https://example.com' }, host.context), { code: 'CAPABILITY_UNAVAILABLE' })
  assert.equal(host.snapshot().revision, 1)
  assert.equal(host.snapshot().value.items.length, 1)
  assert.equal(host.calls.filter(call => call.method === 'storage.compareAndSet').length, 1)
  assert.equal(host.calls.filter(call => call.method === 'events.emit').length, 1)
})

test('denied reads and conflicting writes stop without subsequent effects', async () => {
  for (const failAt of ['tabs.read', 'storage.read', 'storage.compareAndSet']) {
    const host = localHost({ page: { title: 'Page', url: 'https://example.com' }, failAt })
    await assert.rejects(addSelectedPage({}, host.context), /Mock failure/)
    assert.equal(host.calls.at(-1).method, failAt)
    assert.deepEqual(host.snapshot(), { revision: 0, value: null })
    assert.equal(host.calls.some(call => call.method === 'events.emit'), false)
  }
})

test('invalid stored state and a full queue are never overwritten', async () => {
  for (const value of [{ wrong: true }, { items: [null] }, { items: [{ title: 1, url: 'x' }] }]) {
    const host = localHost({ value, revision: 5 })
    await assert.rejects(add({ title: 'New', url: 'https://example.com' }, host.context), /refusing to overwrite/)
    assert.deepEqual(host.snapshot(), { value, revision: 5 })
    assert.deepEqual(host.calls.map(call => call.method), ['storage.read'])
  }
  const value = { items: Array.from({ length: 500 }, () => ({ title: 'Page', url: 'https://example.com' })) }
  const host = localHost({ value, revision: 500 })
  await assert.rejects(add({ title: 'One too many', url: 'https://example.com' }, host.context), /limited to 500/)
  assert.deepEqual(host.snapshot(), { value, revision: 500 })
  assert.deepEqual(host.calls.map(call => call.method), ['storage.read'])
})

test('the public input schema rejects missing fields, extra target IDs and oversized values', () => {
  const schema = manifest.provides.actions.add.inputSchema
  for (const input of [{ title: 'Missing URL' }, { title: '', url: '' }, { title: '', url: 'x', tabId: 'tab_any' }, { title: 'x'.repeat(501), url: 'x' }]) {
    assert.throws(() => validateAppValue(schema, input), { code: 'INVALID_ARGUMENT' })
  }
})
