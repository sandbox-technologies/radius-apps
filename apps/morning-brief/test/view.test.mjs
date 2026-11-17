import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseAppJson, parseAppManifest } from '@radius/apps-sdk'
import { mountMorningBrief } from '../bundle/ui/view.js'

const html = await readFile(new URL('../bundle/ui/index.html', import.meta.url), 'utf8')
const manifest = parseAppManifest(parseAppJson(await readFile(new URL('../bundle/radius-app.json', import.meta.url), 'utf8')))
const copy = value => structuredClone(value)
const failure = code => Object.assign(new Error('Private host text is not part of a view receipt'), { code })

// Trusted developer aids only: no browser, sandbox, native runner, model,
// grant approval, artifact publication, or screenshot is involved. Every run
// and artifact below is an explicitly synthetic SDK response fixture.
class Element {
  constructor(tag = 'div') { this.tag = tag }
  textContent = ''
  disabled = false
  dataset = {}
  children = []
  listeners = new Map()
  attributes = {}
  getAttribute(name) { return this.attributes[name] ?? null }
  scrollIntoView(options) { this.scrolled = options }
  focus(options) { this.focused = options }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.children = children }
  addEventListener(event, callback) { this.listeners.set(event, callback) }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]) }
  async click() {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    await this.listeners.get('click')?.(event)
    return event
  }
  set innerHTML(_value) { assert.fail('Untrusted host values must never be rendered as HTML') }
}

function receipt(status = 'queued', extras = {}) {
  return { id: 'run_fixture', installationId: 'install_fixture', instanceId: 'instance_fixture', action: 'generate', status,
    createdAt: '2026-11-16T08:30:00Z', deadline: '2026-11-16T08:32:00Z', effects: [], ...extras }
}

async function view(options = {}) {
  const elements = Object.fromEntries([...html.matchAll(/<([a-z]+)[^>]*\bid="([a-z-]+)"/g)].map(([, tag, id]) => [id, new Element(tag)]))
  const links = [...html.matchAll(/<a\b[^>]*href="(#[a-z-]+)"/g)].map(([, href]) => {
    const link = new Element('a'); link.attributes.href = href; return link
  })
  const state = {
    description: { apiVersion: 'radius.apps/1', manifest: copy(manifest),
      installation: { id: 'install_fixture', appId: manifest.id, releaseDigest: 'digest_fixture', enabled: true,
        grants: ['activity', 'generation', 'reports', 'readReports', 'openReports'], epoch: 1, allowAgentInvocation: false, createdAt: '2026-11-16T00:00:00Z' },
      executionProfiles: [], limits: {}, actions: { generate: { ...copy(manifest.provides.actions.generate), unavailable: 'CAPABILITY_UNAVAILABLE: no qualified hard-budget runner' } } },
    instance: { id: 'instance_fixture', installationId: 'install_fixture', configurationRevision: 3,
      configuration: { title: 'My morning brief', timeZone: 'America/Los_Angeles', todayPriorities: 'Review my proposal' } },
    runs: [], artifacts: [], triggers: [], current: receipt(), errors: {}, calls: [], time: 0, timers: new Map(), nextTimer: 0,
  }
  if (options.available) state.description.actions.generate.unavailable = null
  if (options.generation) state.description.generation = copy(options.generation)
  if (options.grants) state.description.installation.grants = options.grants
  if (options.instance !== undefined) state.instance = options.instance
  if (options.runs) state.runs = options.runs
  if (options.artifacts) state.artifacts = options.artifacts
  if (options.triggers) state.triggers = options.triggers
  const methods = {
    describe: () => state.description,
    getInstance: () => state.instance,
    listRuns: () => state.runs.map(({ id, installationId, instanceId, action, status, createdAt, deadline }) =>
      ({ id, installationId, instanceId, action, status, createdAt, deadline })),
    listArtifacts: () => state.artifacts,
    listTriggers: () => state.triggers,
    invoke: () => { state.runs = [state.current]; return state.current },
    getRun: id => state.runs.find(run => run.id === id) || state.current,
    cancelRun: () => { state.current = { ...state.current, status: 'cancelling' }; state.runs = [state.current] },
    openArtifact: () => null,
    events: () => { assert.fail('This view uses explicit refresh and bounded receipt checking, not unbounded event polling') },
  }
  const sdk = Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, async (...args) => {
    state.calls.push({ name, args: copy(args) })
    if (state.errors[name]) throw state.errors[name]
    return copy(await method(...args))
  }]))
  for (const name of options.missing ?? []) delete sdk[name]
  const listeners = new Map()
  const document = { visibilityState: 'visible', querySelector: selector => elements[selector.slice(1)],
    querySelectorAll: selector => { assert.equal(selector, 'a[href^="#"]'); return links }, createElement: tag => new Element(tag) }
  const window = {
    radiusApp: options.bridge === false ? undefined : sdk,
    addEventListener: (event, callback) => listeners.set(event, callback),
    setTimeout: (callback, delay) => { const id = ++state.nextTimer; state.timers.set(id, { callback, at: state.time + delay }); return id },
    clearTimeout: id => state.timers.delete(id),
  }
  const mounted = mountMorningBrief({ document, window, now: () => state.time })
  await mounted.ready
  return {
    state, sdk, elements, document, links,
    calls: name => state.calls.filter(call => call.name === name),
    click: id => elements[id].click(),
    close: () => listeners.get('pagehide')(),
    setReceipt: next => { state.current = next; state.runs = [next] },
    async tick(elapsed = 1000) {
      state.time += elapsed
      const due = [...state.timers].filter(([, timer]) => timer.at <= state.time)
      for (const [id, timer] of due) { state.timers.delete(id); await timer.callback() }
    },
  }
}

const content = element => [element.textContent, ...element.children.map(content)].join('\n')
const syntheticArtifact = { id: 'artifact_fixture', runId: 'past_run_fixture', title: 'Synthetic saved metadata fixture', createdAt: '2026-11-15T08:31:00Z' }

test('in-page guidance and skip links never navigate away from the pinned app URL', async () => {
  const app = await view()
  const calls = copy(app.state.calls)
  assert.ok(app.links.length >= 4)
  for (const link of app.links) {
    const event = await link.click()
    assert.equal(event.defaultPrevented, true)
    const target = app.elements[link.getAttribute('href').slice(1)]
    assert.deepEqual(target.scrolled, { behavior: 'auto', block: 'start' })
    assert.deepEqual(target.focused, { preventScroll: true })
  }
  assert.deepEqual(app.state.calls, calls, 'Scrolling guidance must not request host authority')
  assert.match(html, /<main id="main" tabindex="-1">/)
})

test('startup makes scoped reads only; unavailable generation stays unavailable even with all grants', async () => {
  const app = await view()
  assert.deepEqual(app.state.calls.map(call => call.name), ['describe', 'getInstance', 'listRuns', 'listTriggers', 'listArtifacts'])
  assert.ok(app.state.calls.every(call => call.args.length === 0))
  assert.equal(app.elements['run-now'].disabled, true)
  assert.match(app.elements.availability.textContent, /no qualified hard-budget runner/)
  await app.click('run-now') // Defense even if a caller dispatches a disabled control.
  assert.equal(app.calls('invoke').length, 0)
  assert.equal(app.state.timers.size, 0)
  assert.match(app.elements['schedule-note'].textContent, /only a suggestion/)
})

test('host generation reason and required ceilings are separate from missing grants', async () => {
  const generation = { profile: 'restricted-generation', available: false,
    unavailable: 'Pinned runner cannot enforce hard pre-spend limits <untrusted text>',
    usageBudget: { maxTotalTokens: 8192, maxCostUsd: 1 } }
  const app = await view({ available: true, grants: [], generation })
  assert.match(app.elements['host-generation'].textContent, /Host generation is unavailable/)
  assert.ok(app.elements['host-generation'].textContent.includes(generation.unavailable))
  assert.match(content(app.elements['host-budget']), /8,192/)
  assert.match(content(app.elements['host-budget']), /\$1 USD/)
  assert.match(content(app.elements.capabilities), /generation: Not approved/)
  await app.click('run-now')
  assert.equal(app.calls('invoke').length, 0)
  assert.equal(app.elements['run-now'].disabled, true)
  app.state.description.generation.available = true
  app.state.description.generation.unavailable = null
  await app.click('refresh')
  assert.match(app.elements['host-generation'].textContent, /Host generation is available/)
  assert.match(app.elements.availability.textContent, /separately approved grants/)
  assert.equal(app.elements['run-now'].disabled, true)
})

test('ceilings come from the host and receipt independently, never constants or actual usage', async () => {
  const app = await view({ available: true, generation: { profile: 'restricted-generation', available: true, unavailable: null,
    usageBudget: { maxTotalTokens: 4096, maxCostUsd: 0.125 } } })
  assert.match(content(app.elements['host-budget']), /4,096/)
  assert.match(content(app.elements['host-budget']), /\$0.125 USD/)
  app.setReceipt(receipt('queued', { usageBudget: { maxTotalTokens: 1024, maxCostUsd: 0.0035 } }))
  app.state.runs = []
  await app.click('run-now')
  assert.match(content(app.elements['receipt-budget']), /1,024/)
  assert.match(content(app.elements['receipt-budget']), /\$0.0035 USD/)
  assert.doesNotMatch(content(app.elements['receipt-budget']), /4,096|0\.125/)
  app.setReceipt(receipt('succeeded', { result: { artifactId: 'artifact_fixture' } }))
  await app.tick()
  assert.match(content(app.elements['receipt-budget']), /Unknown \(not reported\)/)
  assert.doesNotMatch(content(app.elements['receipt-budget']), /1,024|4,096|\$/)
  assert.match(html, /Required ceilings · not actual usage/)
  assert.match(html, /Admitted ceilings · not actual usage/)
})

test('older, incomplete, and malformed optional metadata stays unknown without invented ceilings', async () => {
  const app = await view({ available: true })
  assert.match(app.elements['host-generation'].textContent, /unknown/)
  assert.match(content(app.elements['host-budget']), /Unknown/)
  assert.match(content(app.elements['receipt-budget']), /Unknown/)
  assert.doesNotMatch(content(app.elements['host-budget']), /8,192|\$1/)
  app.state.description.generation = { available: true, unavailable: null, usageBudget: { maxTotalTokens: 512 } }
  await app.click('refresh')
  assert.match(content(app.elements['host-budget']), /512/)
  assert.match(content(app.elements['host-budget']), /Cost ceiling \(USD\)\nUnknown/)
  app.state.description.generation.usageBudget = { maxTotalTokens: '8192', maxCostUsd: Infinity }
  await app.click('refresh')
  assert.doesNotMatch(content(app.elements['host-budget']), /8,192|Infinity|\$/)
})

test('ordinary browser and partial bridge show honest errors, not synthetic reports', async () => {
  for (const options of [{ bridge: false }, { missing: ['getRun'] }]) {
    const app = await view(options)
    assert.equal(app.state.calls.length, 0)
    assert.match(app.elements.notice.textContent, /no app bridge/)
    assert.equal(app.elements['run-now'].disabled, true)
    assert.equal(app.elements.refresh.disabled, true)
    assert.equal(app.elements.artifacts.children.length, 0)
  }
})

test('the original four-method host gets feature-specific native-management guidance', async () => {
  const app = await view({ available: true, missing: ['getInstance', 'listRuns', 'cancelRun', 'listArtifacts', 'openArtifact', 'listTriggers'] })
  assert.deepEqual(app.state.calls.map(call => call.name), ['describe'])
  for (const id of ['instance-note', 'runs-note', 'artifacts-note', 'schedule-note']) assert.match(app.elements[id].textContent, /older host/)
  assert.match(app.elements['cancel-help'].textContent, /native Apps management/)
  assert.equal(app.elements['run-now'].disabled, true)
  assert.equal(app.elements['cancel-run'].disabled, true)
})

test('missing required grants and a missing instance cannot be confused with available generation', async () => {
  for (const grants of [['generation', 'reports'], ['activity', 'reports'], ['activity', 'generation']]) {
    const app = await view({ available: true, grants })
    await app.click('run-now')
    assert.equal(app.elements['run-now'].disabled, true)
    assert.equal(app.calls('invoke').length, 0)
  }
  const app = await view({ available: true, instance: null })
  assert.match(app.elements['instance-note'].textContent, /No instance is bound/)
  assert.equal(app.elements['run-now'].disabled, true)
  assert.equal(app.calls('invoke').length, 0)
})

test('missing/malformed availability never means available; the agent-transport flag is not a view grant', async () => {
  const app = await view({ available: true })
  assert.equal(app.elements['run-now'].disabled, false)
  assert.equal(app.state.description.installation.allowAgentInvocation, false)
  for (const value of [undefined, '', false]) {
    app.state.description.actions.generate.unavailable = value
    await app.click('refresh')
    assert.equal(app.elements['run-now'].disabled, true)
  }
  app.state.description.actions.generate.unavailable = null
  app.state.description.installation.enabled = false
  await app.click('refresh')
  assert.equal(app.elements['run-now'].disabled, true)
})

test('optional read/open access is separate from generation and never requested automatically', async () => {
  const app = await view({ available: true, grants: ['activity', 'generation', 'reports'] })
  assert.equal(app.elements['run-now'].disabled, false)
  assert.equal(app.calls('listArtifacts').length, 0)
  assert.match(app.elements['artifacts-note'].textContent, /have not been read/)
  assert.equal(app.calls('openArtifact').length, 0)
})

test('explicit configuration, priorities, revisions, and artifact metadata are rendered as text', async () => {
  const malicious = '<img src=x onerror=alert(1)>\njavascript:do-not-navigate'
  const app = await view({
    instance: { id: 'instance_fixture', configurationRevision: 5, configuration: { title: malicious, timeZone: 'Pacific/Honolulu', todayPriorities: malicious } },
    artifacts: [{ ...syntheticArtifact, title: malicious, html: '<script>private body not a metadata field</script>' }],
  })
  assert.match(content(app.elements.configuration), /Pacific\/Honolulu/)
  assert.ok(content(app.elements.configuration).includes(malicious))
  assert.ok(content(app.elements.artifacts).includes(malicious))
  assert.doesNotMatch(content(app.elements.artifacts), /private body/)
  assert.match(app.elements['instance-note'].textContent, /own configuration snapshot/)
  delete app.state.instance.configuration.todayPriorities
  await app.click('refresh')
  assert.match(content(app.elements.configuration), /Not set \(optional\)/)
})

test('Run now rechecks availability and invokes only the existing empty-input generate action', async () => {
  const app = await view({ available: true })
  await app.click('run-now')
  assert.deepEqual(app.calls('invoke'), [{ name: 'invoke', args: ['generate', {}] }])
  assert.equal(app.calls('describe').length, 2)
  assert.equal(app.elements['run-status'].textContent, 'queued')
  assert.match(app.elements['run-message'].textContent, /No result/)
  assert.equal(app.elements['run-now'].disabled, true)
  assert.equal(app.state.timers.size, 1)
  app.setReceipt(receipt('running'))
  await app.tick()
  assert.equal(app.elements['run-status'].textContent, 'running')
  app.setReceipt(receipt('succeeded', { result: { artifactId: 'artifact_fixture' }, finishedAt: '2026-11-16T08:31:00Z' }))
  await app.tick()
  assert.match(content(app.elements.receipt), /artifact_fixture/)
  assert.equal(app.state.timers.size, 0)
  assert.equal(app.calls('openArtifact').length, 0)
  assert.equal(app.calls('invoke').length, 1)
})

test('capability changes between rendering and a click prevent admission', async () => {
  const app = await view({ available: true })
  app.state.description.actions.generate.unavailable = 'CAPABILITY_UNAVAILABLE'
  await app.click('run-now')
  assert.equal(app.calls('invoke').length, 0)
  assert.equal(app.elements['run-now'].disabled, true)
})

test('an unavailable admission invalidates discovery and never swaps in another runner', async () => {
  const app = await view({ available: true })
  app.state.errors.invoke = failure('CAPABILITY_UNAVAILABLE')
  await app.click('run-now')
  assert.equal(app.calls('invoke').length, 1)
  assert.equal(app.elements['run-now'].disabled, true)
  assert.equal(app.state.timers.size, 0)
  assert.match(app.elements.notice.textContent, /CAPABILITY_UNAVAILABLE/)
  await app.click('run-now')
  assert.equal(app.calls('invoke').length, 1)
})

test('fresh history blocks work started elsewhere; refresh updates a selected terminal receipt', async () => {
  const app = await view({ available: true })
  app.state.runs = [receipt()]
  await app.click('run-now')
  assert.equal(app.calls('invoke').length, 0)
  assert.equal(app.elements['run-now'].disabled, true)
  await app.elements.runs.querySelectorAll('button')[0].click()
  await app.click('stop-checking')
  app.setReceipt(receipt('cancelled'))
  await app.click('refresh')
  assert.equal(app.elements['run-status'].textContent, 'cancelled')
  assert.equal(app.elements['run-now'].disabled, false)
  assert.equal(app.state.timers.size, 0)
})

test('mismatched receipts fail closed without inventing results or retrying', async () => {
  const app = await view({ available: true })
  await app.click('run-now')
  app.sdk.getRun = async () => receipt('succeeded', { id: 'wrong_run', result: { artifactId: 'wrong_artifact' } })
  await app.tick()
  assert.match(app.elements.notice.textContent, /INVALID_HOST_RESPONSE/)
  assert.doesNotMatch(content(app.elements.receipt), /wrong_artifact/)
  assert.equal(app.state.timers.size, 0)
  assert.equal(app.calls('invoke').length, 1)
})

test('repeated clicks during pending admission cannot create duplicate work', async () => {
  const app = await view({ available: true })
  let resolve
  app.sdk.invoke = async (...args) => {
    app.state.calls.push({ name: 'invoke', args })
    return new Promise(done => { resolve = done })
  }
  const pending = app.click('run-now')
  for (let i = 0; i < 20 && !resolve; i++) await Promise.resolve()
  assert.ok(resolve)
  await app.click('run-now')
  resolve(receipt())
  await pending
  assert.equal(app.calls('invoke').length, 1)
  app.close()
})

test('failed, cancelled, and interrupted receipts preserve error codes/effects without retry or rollback claims', async () => {
  for (const status of ['failed', 'cancelled', 'interrupted']) {
    const app = await view({ available: true })
    await app.click('run-now')
    app.setReceipt(receipt(status, { error: { code: 'EFFECT_UNKNOWN' }, effects: [
      { method: 'artifacts.write', status: 'committed', at: '2026-11-16T08:31:00Z' },
      { method: 'events.emit', status: 'unknown', at: '2026-11-16T08:31:01Z' },
    ] }))
    await app.tick()
    assert.equal(app.elements['run-status'].textContent, status)
    assert.match(content(app.elements.receipt), /EFFECT_UNKNOWN/)
    assert.match(content(app.elements.effects), /committed/)
    assert.match(content(app.elements.effects), /unknown/)
    assert.equal(app.state.timers.size, 0)
    assert.equal(app.calls('invoke').length, 1)
  }
})

test('missing/malformed admission receipts and transport failure block replay, even after refresh', async () => {
  for (const result of [null, { id: 'run_fixture', status: 'running' }]) {
    const app = await view({ available: true })
    app.sdk.invoke = async () => { app.state.calls.push({ name: 'invoke', args: ['generate', {}] }); return result }
    await app.click('run-now')
    assert.match(app.elements.notice.textContent, /INVALID_HOST_RESPONSE/)
    await app.click('refresh')
    await app.click('run-now')
    assert.match(app.elements.availability.textContent, /outcome is unknown/)
    assert.equal(app.calls('invoke').length, 1)
  }
  const app = await view({ available: true })
  app.state.errors.invoke = failure('CONNECTION_LOST')
  await app.click('run-now')
  assert.match(app.elements.notice.textContent, /CONNECTION_LOST/)
  assert.equal(app.elements['run-now'].disabled, true)
})

test('cancellation is explicit, scoped to a selected run, and not confirmed until its receipt says so', async () => {
  const app = await view({ available: true })
  await app.click('run-now')
  assert.equal(app.calls('cancelRun').length, 0)
  await app.click('cancel-run')
  assert.deepEqual(app.calls('cancelRun'), [{ name: 'cancelRun', args: ['run_fixture'] }])
  assert.equal(app.elements['run-status'].textContent, 'cancelling')
  assert.equal(app.elements['cancel-run'].disabled, true)
  assert.match(app.elements['run-message'].textContent, /not confirmed/)
  app.setReceipt(receipt('cancelled'))
  await app.tick()
  assert.equal(app.elements['run-status'].textContent, 'cancelled')
  assert.equal(app.state.timers.size, 0)
})

test('older hosts can inspect unfinished receipts without attempting an unavailable cancel method', async () => {
  const app = await view({ runs: [receipt()], missing: ['cancelRun'] })
  await app.elements.runs.querySelectorAll('button')[0].click()
  assert.equal(app.elements['cancel-run'].disabled, true)
  await app.click('cancel-run')
  assert.equal(app.calls('cancelRun').length, 0)
  assert.match(app.elements['cancel-help'].textContent, /older host/)
  app.close()
})

test('stopping checks and the bounded wait timeout never cancel or rerun a pending run', async () => {
  const app = await view({ available: true })
  await app.click('run-now')
  await app.click('stop-checking')
  assert.equal(app.state.timers.size, 0)
  assert.match(app.elements['run-message'].textContent, /NOT cancelled/)
  await app.click('check-run')
  assert.equal(app.state.timers.size, 1)
  await app.tick(125_000)
  assert.equal(app.state.timers.size, 0)
  assert.match(app.elements['run-message'].textContent, /local wait limit/)
  assert.equal(app.calls('cancelRun').length, 0)
  assert.equal(app.calls('invoke').length, 1)
  assert.equal(app.elements['run-now'].disabled, true)
})

test('hidden documents pause receipt reads; teardown clears timers and does not cancel', async () => {
  const app = await view({ available: true })
  await app.click('run-now')
  app.document.visibilityState = 'hidden'
  await app.tick()
  assert.equal(app.calls('getRun').length, 0)
  app.document.visibilityState = 'visible'
  await app.tick()
  assert.equal(app.calls('getRun').length, 1)
  app.close()
  assert.equal(app.state.timers.size, 0)
  await app.tick()
  assert.equal(app.calls('cancelRun').length, 0)
})

test('revocation stops observation and clears cached configuration, history, and report access', async () => {
  const app = await view({ available: true, artifacts: [syntheticArtifact] })
  await app.click('run-now')
  app.state.errors.getRun = failure('PERMISSION_DENIED')
  await app.tick()
  assert.match(app.elements.notice.textContent, /PERMISSION_DENIED/)
  assert.equal(app.state.timers.size, 0)
  assert.equal(app.elements.artifacts.children.length, 0)
  assert.equal(app.elements.configuration.children.length, 0)
  assert.equal(app.elements.refresh.disabled, true)
  await app.tick()
  assert.equal(app.calls('getRun').length, 1)
})

test('an in-flight receipt resolved after teardown never mutates the view or rearms checking', async () => {
  const app = await view({ available: true })
  await app.click('run-now')
  let resolve
  app.sdk.getRun = () => new Promise(done => { resolve = done })
  const pending = app.tick()
  assert.ok(resolve)
  app.close()
  resolve(receipt('succeeded', { result: { artifactId: 'artifact_fixture' } }))
  await pending
  assert.equal(app.elements['run-status'].textContent, 'queued')
  assert.equal(app.state.timers.size, 0)
})

test('artifact opening is a separate explicit operation with a fresh grant check, never generation', async () => {
  const app = await view({ artifacts: [syntheticArtifact] })
  assert.equal(app.calls('openArtifact').length, 0)
  await app.elements.artifacts.querySelectorAll('button')[0].click()
  assert.deepEqual(app.calls('openArtifact'), [{ name: 'openArtifact', args: ['artifact_fixture'] }])
  assert.equal(app.calls('invoke').length, 0)
  assert.match(app.elements['artifact-status'].textContent, /accepted the open request/)
  assert.equal(app.calls('describe').length, 2)
})

test('artifact buttons respect missing or revoked open grants and older hosts', async () => {
  for (const options of [{ grants: ['readReports'] }, { missing: ['openArtifact'] }]) {
    const app = await view({ ...options, artifacts: [syntheticArtifact] })
    const button = app.elements.artifacts.querySelectorAll('button')[0]
    assert.equal(button.disabled, true)
    await button.click()
    assert.equal(app.calls('openArtifact').length, 0)
  }
  const app = await view({ artifacts: [syntheticArtifact] })
  app.state.description.installation.grants = ['readReports']
  await app.elements.artifacts.querySelectorAll('button')[0].click()
  assert.equal(app.calls('openArtifact').length, 0)
  assert.match(app.elements['artifact-status'].textContent, /access changed/)
})

test('native trigger state is displayed without creating, enabling, or changing a binding', async () => {
  const app = await view({ triggers: [{ id: 'binding_fixture', trigger: 'morning', enabled: false, revision: 4,
    localTime: '09:15', timeZone: 'Europe/Paris', delivery: 'none' }] })
  assert.match(content(app.elements.schedules), /Disabled/)
  assert.match(content(app.elements.schedules), /09:15 · Europe\/Paris/)
  assert.match(content(app.elements.schedules), /Delivery: none/)
  assert.match(app.elements['schedule-note'].textContent, /explicitly reapprove/)
  assert.ok(app.state.calls.every(call => ['describe', 'getInstance', 'listRuns', 'listTriggers', 'listArtifacts'].includes(call.name)))
})

test('local assets, text rendering, feature checks, and the shared Reduced Motion token stay explicit', async () => {
  const source = await readFile(new URL('../bundle/ui/view.js', import.meta.url), 'utf8')
  const entry = await readFile(new URL('../bundle/ui/app.js', import.meta.url), 'utf8')
  const css = await readFile(new URL('../bundle/ui/styles.css', import.meta.url), 'utf8')
  assert.doesNotMatch(source + entry, /innerHTML|insertAdjacentHTML|localStorage|sessionStorage|indexedDB|ipcRenderer|fetch\s*\(|XMLHttpRequest|WebSocket|window\.(api|electron|open)|\.host\.call|sdk\.call\s*\(/)
  assert.doesNotMatch(source + entry, /APP_GENERATION_LIMITS|8192|8_192|8,192/)
  assert.doesNotMatch(html + css + source + entry, /https?:\/\/|@import|url\(/)
  assert.match(entry, /from '\.\/view\.js'/)
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert.ok(match[1].startsWith('#') || ['styles.css', 'app.js'].includes(match[1]))
  }
  assert.match(css, /--interaction-duration: 80ms/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /--interaction-duration: 0ms/)
  assert.match(css, /:focus-visible/)
  assert.match(html, /role="status" aria-live="polite"/)
  assert.doesNotMatch(html, /<iframe|<form|<input|<textarea|contenteditable/)
  assert.match(html, /not a native-navigation link/)
})
