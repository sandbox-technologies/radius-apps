import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { parseAppJson, parseAppManifest, validateAppValue } from '@radius/apps-sdk'
import { appBundleDigest, validateAppBundleFiles } from '@radius/apps-sdk/release'
import { generate } from '../bundle/worker.js'

const manifest = parseAppManifest(parseAppJson(await readFile(new URL('../bundle/radius-app.json', import.meta.url), 'utf8')))
const action = manifest.provides.actions.generate
const configuration = { title: 'Disposable synthetic report', timeZone: 'America/Los_Angeles' }
const logicalTime = '2026-11-16T16:30:00.000Z'

// Developer aid only: NOT the native broker, scheduler, artifact store or sandbox.
function localHost({ config = configuration, at = logicalTime, artifactId = 'artifact_local_test', fail, ids = {} } = {}) {
  const calls = []
  const context = {
    metadata: {
      runId: 'run_local_test', installationId: 'install_local_test', instanceId: 'instance_local_test',
      ...ids, configuration: structuredClone(config), logicalTime: at,
    },
    host: { async call(method, input) {
      calls.push({ method, input: structuredClone(input) })
      assert.equal(method, 'artifacts.publish', 'no storage, provider, open or other implicit effect is allowed')
      assert.deepEqual(Object.keys(input).sort(), ['html', 'title'])
      assert.equal(typeof input.html, 'string')
      assert.ok(input.html.trim())
      assert.ok(Buffer.byteLength(input.html) < 128 * 1024, 'publish request stays within the host input limit')
      assert.equal(typeof input.title, 'string')
      assert.ok(input.title.length > 0 && input.title.length <= 200)
      assert.doesNotMatch(input.title, /\p{Cc}/u)
      if (fail) throw fail
      // Extra mock data must not leak through the public action result.
      return { artifactId, opened: false, unrelated: 'host-only' }
    } },
  }
  return { context, calls }
}

async function invoke(input = {}, options) {
  const host = localHost(options)
  validateAppValue(manifest.configurationSchema, host.context.metadata.configuration)
  validateAppValue(action.inputSchema, input)
  const result = await generate(input, host.context)
  validateAppValue(action.outputSchema, result)
  assert.equal(host.calls.length, 1)
  return { ...host, result, publication: host.calls[0].input }
}

test('complete 0.1.0 experimental bundle validates with an exact copy of the approved MIT license', async () => {
  const names = (await readdir(new URL('../bundle/', import.meta.url))).sort()
  assert.deepEqual(names, ['LICENSE', 'radius-app.json', 'worker.js'])
  const files = Object.fromEntries(await Promise.all(names.map(async name => [name,
    (await readFile(new URL(`../bundle/${name}`, import.meta.url))).toString('base64'),
  ])))
  const bundle = validateAppBundleFiles(files)
  assert.equal(bundle.manifest.id, 'dev.radius.scheduled-report-lab')
  assert.equal(bundle.manifest.version, '0.1.0')
  assert.equal(bundle.digest, appBundleDigest(files))
  assert.deepEqual(bundle.manifest.worker, { entry: 'worker.js' })
  assert.equal(await readFile(new URL('../bundle/LICENSE', import.meta.url), 'utf8'),
    await readFile(new URL('../../../LICENSE', import.meta.url), 'utf8'))
  const metadata = parseAppJson(await readFile(new URL('../app.json', import.meta.url), 'utf8'))
  assert.equal(metadata.slug, 'scheduled-report-lab')
  assert.equal(metadata.status, 'experimental')
  assert.equal(metadata.license, 'MIT')
  assert.deepEqual(metadata.screenshots, [])
})

test('handler requires only owned publication, with opening declared separately and no agent or storage access', () => {
  assert.deepEqual(manifest.requires, {
    reports: { capability: 'artifacts.write', scope: { owner: 'self' } },
    openReports: { capability: 'artifacts.open', scope: { owner: 'self' } },
  })
  assert.deepEqual(Object.keys(manifest.provides.actions), ['generate'])
  assert.deepEqual(action.requires, ['reports'])
  assert.deepEqual(action.implementation, { kind: 'handler', export: 'generate' })
  assert.deepEqual(action.contexts, ['app'])
  assert.deepEqual(manifest.provides.views, {})
  assert.deepEqual(manifest.provides.events, {})
  assert.equal(manifest.instances.mode, 'multiple')
})

test('daily schedule is a local-time suggestion, not an enabled binding or implicit delivery', () => {
  assert.deepEqual(manifest.provides.triggers, {
    daily: { kind: 'schedule', action: 'generate', input: {}, suggested: { localTime: '08:30' } },
  })
  validateAppValue(action.inputSchema, manifest.provides.triggers.daily.input)
  for (const extra of [{ enabled: true }, { delivery: 'background-tab' }]) {
    const changed = structuredClone(manifest)
    Object.assign(changed.provides.triggers.daily, extra)
    assert.throws(() => parseAppManifest(changed), { code: 'INVALID_ARGUMENT' })
  }
})

test('defaults render a labeled synthetic report and publish exactly once without opening', async () => {
  const { calls, result, publication } = await invoke()
  assert.deepEqual(result, { artifactId: 'artifact_local_test' })
  assert.deepEqual(calls.map(call => call.method), ['artifacts.publish'])
  assert.equal(publication.title, 'Disposable synthetic report — Synthetic report')
  assert.match(publication.html, /Synthetic test data — not AI-generated\./)
  assert.match(publication.html, /does not read activity, browse, call a provider, or generate a Morning Brief/)
  assert.match(publication.html, /2026-11-16T16:30:00\.000Z/)
  assert.match(publication.html, /America\/Los_Angeles/)
  assert.match(publication.html, /Bundled fixture data; no live sources were read\./)
  for (const [label, value] of [['A', 3], ['B', 5], ['C', 8]]) {
    assert.ok(publication.html.includes(`Synthetic sample ${label}</th><td>${value}</td>`))
  }
  assert.match(publication.html, /Synthetic total<\/th><td>16<\/td>/)
})

test('hostile strings are escaped in every HTML slot and cannot introduce active or remote content', async () => {
  const config = { title: '<img src=x onerror="bad()">&\'Lab', timeZone: '<svg onload="bad()">&\'Zone' }
  // Deliberately invalid IANA label tests rendering only, NOT native schedule admission.
  const input = {
    note: '</p><script src="https://evil.example/a">bad()</script>&lt;already&gt;\'"',
    items: [{ label: '<iframe src="https://evil.example/">&\'"', value: 7 }],
  }
  const { publication } = await invoke(input, { config })
  assert.equal(publication.title, `${config.title} — Synthetic report`, 'broker title is plain text, not HTML')
  for (const escaped of [
    '&lt;img src=x onerror=&quot;bad()&quot;&gt;&amp;&#39;Lab',
    '&lt;svg onload=&quot;bad()&quot;&gt;&amp;&#39;Zone',
    '&lt;/p&gt;&lt;script src=&quot;https://evil.example/a&quot;&gt;bad()&lt;/script&gt;&amp;lt;already&amp;gt;&#39;&quot;',
    '&lt;iframe src=&quot;https://evil.example/&quot;&gt;&amp;&#39;&quot;',
  ]) assert.ok(publication.html.includes(escaped), escaped)
  assert.doesNotMatch(publication.html, /<(?:script|iframe|img|svg|link|style|object|embed|form|a)\b/i)
  assert.doesNotMatch(publication.html, /<[^>]+\s(?:src|href|srcset|style|on\w+)\s*=/i)
  assert.match(publication.html, /content="default-src 'none'; base-uri 'none'; form-action 'none'"/)
})

test('same input, configuration and logical time give identical bytes despite different host identities and ambient clock', async t => {
  t.mock.method(Date, 'now', () => { throw new Error('Ambient time is forbidden') })
  t.mock.method(Math, 'random', () => { throw new Error('Random output is forbidden') })
  const input = { note: 'Fixed fixture', items: [{ label: 'Explicit', value: 11 }] }
  const original = structuredClone(input)
  const first = await invoke(input, { artifactId: 'artifact_first' })
  const second = await invoke(input, {
    artifactId: 'artifact_second',
    ids: { runId: 'run_other', installationId: 'install_other', instanceId: 'instance_other' },
  })
  assert.deepEqual(first.publication, second.publication)
  assert.notDeepEqual(first.result, second.result, 'host artifact IDs are intentionally not deterministic')
  assert.deepEqual(input, original)
  assert.match(first.publication.html, /Synthetic total<\/th><td>11<\/td>/)
  assert.doesNotMatch(first.publication.html, /Synthetic sample A|run_local_test|instance_local_test/)
  const later = await invoke(input, { at: '2026-11-17T16:30:00.000Z' })
  assert.notEqual(later.publication.html, first.publication.html)
  assert.equal(later.publication.html.replaceAll('2026-11-17T16:30:00.000Z', logicalTime), first.publication.html)
})

test('explicit empty input values stay empty rather than restoring bundled fixtures', async () => {
  const { publication } = await invoke({ note: '', items: [] })
  assert.match(publication.html, /No synthetic rows supplied\./)
  assert.match(publication.html, /Synthetic total<\/th><td>0<\/td>/)
  assert.doesNotMatch(publication.html, /Bundled fixture data|Synthetic sample [ABC]/)
})

test('bounded Unicode configuration and largest fixture remain inside publication limits', async () => {
  const { publication } = await invoke({
    note: '"'.repeat(500),
    items: Array.from({ length: 20 }, () => ({ label: '"'.repeat(120), value: 1000000 })),
  }, { config: { title: '🧪'.repeat(80), timeZone: 'UTC' } })
  assert.ok(publication.title.length <= 200)
  assert.match(publication.html, /Synthetic total<\/th><td>20000000<\/td>/)
})

test('configuration and input schemas reject missing, extra, incorrectly typed and oversized data', () => {
  for (const config of [
    {}, { title: 'Lab' }, { timeZone: 'UTC' }, { ...configuration, title: '' },
    { ...configuration, title: '🧪'.repeat(81) }, { ...configuration, timeZone: '' },
    { ...configuration, timeZone: 'x'.repeat(101) }, { ...configuration, enabled: true },
  ]) assert.throws(() => validateAppValue(manifest.configurationSchema, config), { code: 'INVALID_ARGUMENT' })
  for (const input of [
    { note: null }, { note: 'x'.repeat(501) }, { items: null }, { logicalTime }, { provider: 'not-allowed' },
    { items: Array.from({ length: 21 }, () => ({ label: 'Too many', value: 1 })) },
    ...[{}, { label: 'Missing value' }, { label: '', value: 1 }, { label: 'x'.repeat(121), value: 1 },
      { label: 'Bad value', value: -1 }, { label: 'Bad value', value: 1000001 },
      { label: 'Bad value', value: 1.5 }, { label: 'Bad value', value: '1' },
      { label: 'Extra field', value: 1, url: 'https://example.com' }].map(item => ({ items: [item] })),
  ]) assert.throws(() => validateAppValue(action.inputSchema, input), { code: 'INVALID_ARGUMENT' })
  for (const result of [{ html: '<p>Not an ID</p>' }, { artifactId: '' }, { artifactId: 'id', opened: true }]) {
    assert.throws(() => validateAppValue(action.outputSchema, result), { code: 'INVALID_ARGUMENT' })
  }
})

test('missing or invalid logical time fails without a wall-clock fallback or host effect', async () => {
  for (const at of [null, '', 'yesterday', '2026-11-16T16:30:00Z', '2026-02-30T16:30:00.000Z', '<script>bad()</script>']) {
    const host = localHost({ at })
    await assert.rejects(generate({}, host.context), { code: 'INVALID_ARGUMENT' })
    assert.deepEqual(host.calls, [])
  }
  const host = localHost()
  delete host.context.metadata.logicalTime
  await assert.rejects(generate({}, host.context), { code: 'INVALID_ARGUMENT' })
  assert.deepEqual(host.calls, [])
})

test('blank and control-character titles fail before publication', async () => {
  for (const title of [' ', '\t', 'Lab\nTitle', 'Lab\u0000Title', 'Lab\u0085Title']) {
    const host = localHost({ config: { ...configuration, title } })
    await assert.rejects(generate({}, host.context), { code: 'INVALID_ARGUMENT' })
    assert.deepEqual(host.calls, [])
  }
})

test('publication denial, capacity and ambiguous effects propagate without retry, opening or fallback', async () => {
  for (const code of ['PERMISSION_DENIED', 'CAPABILITY_UNAVAILABLE', 'LIMIT_EXCEEDED', 'EFFECT_UNKNOWN']) {
    const fail = Object.assign(new Error(`Local host double: ${code}`), { code })
    const host = localHost({ fail })
    await assert.rejects(generate({}, host.context), error => error === fail)
    assert.deepEqual(host.calls.map(call => call.method), ['artifacts.publish'])
  }
})

test('packaged worker has no executable imports, provider SDK, ambient clock, timers or open calls', async () => {
  const source = await readFile(new URL('../bundle/worker.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\b(?:import|require|fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval)\s*\(/)
  assert.doesNotMatch(source, /^\s*import\s/m)
  assert.doesNotMatch(source, /\b(?:Date\.now|Math\.random|Intl)\b|new\s+Date\s*\(\s*\)/)
  assert.deepEqual([...source.matchAll(/context\.host\.call\('([^']+)'/g)].map(match => match[1]), ['artifacts.publish'])
  // Source checks supplement worker tests; they are not a security boundary.
})
