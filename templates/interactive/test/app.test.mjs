import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { parseAppJson, parseAppManifest, validateAppValue } from '@radius/apps-sdk'
import { validateAppBundleFiles } from '@radius/apps-sdk/release'
import { greet } from '../bundle/worker.js'

const manifest = parseAppManifest(parseAppJson(await readFile(new URL('../bundle/radius-app.json', import.meta.url), 'utf8')))

test('interactive template packages its complete local worker/view assets', async () => {
  const paths = ['LICENSE', 'radius-app.json', 'worker.js', 'ui/index.html', 'ui/app.js', 'ui/styles.css']
  const files = Object.fromEntries(await Promise.all(paths.map(async path => [path,
    (await readFile(new URL(`../bundle/${path}`, import.meta.url))).toString('base64'),
  ])))
  assert.equal(validateAppBundleFiles(files).manifest.apiVersion, 'radius.apps/1')
})

test('interactive starter returns schema-valid text and requests no privileges', async () => {
  assert.deepEqual(manifest.requires, {})
  assert.deepEqual(manifest.provides.triggers, {})
  assert.equal(manifest.instances.mode, 'none')
  assert.equal(manifest.provides.views.main.entry, 'ui/index.html')
  const action = manifest.provides.actions.greet
  for (const name of ['Ada', '<img src=x onerror=alert(1)>', '🙂'.repeat(120)]) {
    const input = { name }
    validateAppValue(action.inputSchema, input)
    const output = await greet(input, { host: { async call() { assert.fail('greet needs no host calls') } } })
    validateAppValue(action.outputSchema, output)
    assert.deepEqual(output, { message: `Hello, ${name}!` })
  }
  assert.throws(() => validateAppValue(action.inputSchema, { name: '' }), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => validateAppValue(action.inputSchema, { name: 'Ada', tabId: 'tab_any' }), { code: 'INVALID_ARGUMENT' })
})

async function settle(condition) {
  for (let index = 0; index < 100 && !condition(); index++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(condition(), 'mock view did not settle')
}

test('interactive view waits for explicit input and a run receipt, then uses textContent', async () => {
  const elements = Object.fromEntries(['#hello-form', '#greet', '#result', '#name'].map(selector => [selector, {
    value: '<script>text only</script>', disabled: true, textContent: '',
    addEventListener(_name, callback) { this.submit = callback },
  }]))
  const calls = []
  runInNewContext(await readFile(new URL('../bundle/ui/app.js', import.meta.url), 'utf8'), {
    window: { addEventListener() {}, radiusApp: {
      async describe() { return { actions: { greet: { unavailable: null } } } },
      async invoke(action, input) { calls.push({ action, name: input.name }); return { id: 'run_mock', status: 'queued' } },
      async getRun(id) { assert.equal(id, 'run_mock'); return { status: 'succeeded', result: { message: 'Hello, <script>text only</script>!' } } },
    } },
    document: { querySelector: selector => elements[selector] },
    setTimeout() { assert.fail('completed mock run should not need a polling timeout') },
  })
  await settle(() => !elements['#greet'].disabled)
  assert.equal(calls.length, 0, 'loading the view does not invoke an action')
  await elements['#hello-form'].submit({ preventDefault() {} })
  assert.deepEqual(calls, [{ action: 'greet', name: '<script>text only</script>' }])
  assert.equal(elements['#result'].textContent, 'Hello, <script>text only</script>!')
})

test('missing bridge is an error and cannot invoke the greeting', async () => {
  const elements = Object.fromEntries(['#hello-form', '#greet', '#result', '#name'].map(selector => [selector, {
    disabled: true, textContent: '', addEventListener(_name, callback) { this.submit = callback },
  }]))
  runInNewContext(await readFile(new URL('../bundle/ui/app.js', import.meta.url), 'utf8'), {
    window: { addEventListener() {} }, document: { querySelector: selector => elements[selector] },
  })
  await elements['#hello-form'].submit({ preventDefault() {} })
  assert.equal(elements['#greet'].disabled, true)
  assert.match(elements['#result'].textContent, /no app bridge/)
})
