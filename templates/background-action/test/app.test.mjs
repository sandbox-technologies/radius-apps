import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseAppJson, parseAppManifest, validateAppValue } from '@radius/apps-sdk'
import { validateAppBundleFiles } from '@radius/apps-sdk/release'
import { readPage } from '../bundle/worker.js'

const manifest = parseAppManifest(parseAppJson(await readFile(new URL('../bundle/radius-app.json', import.meta.url), 'utf8')))

test('background-action template is a complete independent bundle', async () => {
  const files = Object.fromEntries(await Promise.all(['LICENSE', 'radius-app.json', 'worker.js'].map(async path => [path,
    (await readFile(new URL(`../bundle/${path}`, import.meta.url))).toString('base64'),
  ])))
  assert.equal(validateAppBundleFiles(files).manifest.worker.entry, 'worker.js')
})

test('background action is explicitly invoked and requests only captured title/URL', () => {
  assert.deepEqual(manifest.requires, {
    selectedPage: { capability: 'tabs.read', scope: { target: 'invocation', fields: ['title', 'url'] } },
  })
  assert.equal(manifest.instances.mode, 'none')
  assert.deepEqual(manifest.provides.views, {})
  assert.deepEqual(manifest.provides.triggers, {})
  assert.deepEqual(manifest.provides.actions.readPage.contexts, ['tab'])
})

test('worker calls the public host with no raw target ID and projects only its declared output', async () => {
  const calls = []
  const result = await readPage({}, { host: { async call(method, input) {
    calls.push({ method, input })
    // Extra data deliberately tests output projection, not native field enforcement.
    return { title: '<script>data only</script>', url: 'https://example.com', secret: 'must not return' }
  } } })
  assert.deepEqual(calls, [{ method: 'tabs.read', input: {} }])
  assert.deepEqual(result, { title: '<script>data only</script>', url: 'https://example.com' })
  validateAppValue(manifest.provides.actions.readPage.outputSchema, result)
})

test('target and permission failures propagate without retry or fallback', async () => {
  for (const code of ['PERMISSION_DENIED', 'TARGET_EXPIRED', 'CAPABILITY_UNAVAILABLE']) {
    let calls = 0
    const failure = Object.assign(new Error('Local mock rejection'), { code })
    await assert.rejects(readPage({}, { host: { async call() { calls++; throw failure } } }), error => error === failure)
    assert.equal(calls, 1)
  }
})

test('input schema does not admit caller-selected tab IDs', () => {
  validateAppValue(manifest.provides.actions.readPage.inputSchema, {})
  assert.throws(() => validateAppValue(manifest.provides.actions.readPage.inputSchema, { tabId: 'tab_any' }), { code: 'INVALID_ARGUMENT' })
})
