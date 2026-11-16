import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseAppJson, parseAppManifest, validateAppValue } from '@radius/apps-sdk'
import { validateAppBundleFiles } from '@radius/apps-sdk/release'

const manifest = parseAppManifest(parseAppJson(await readFile(new URL('../bundle/radius-app.json', import.meta.url), 'utf8')))

test('Morning Brief is a packaged agent descriptor, not an executable worker or provider client', async () => {
  const files = Object.fromEntries(await Promise.all(['radius-app.json', 'prompts/brief.md'].map(async path => [path,
    (await readFile(new URL(`../bundle/${path}`, import.meta.url))).toString('base64'),
  ])))
  assert.equal(validateAppBundleFiles(files).manifest.id, 'dev.radius.morning-brief')
  assert.equal(manifest.worker, undefined)
  assert.deepEqual(manifest.provides.views, {})
  assert.deepEqual(manifest.provides.actions.generate.implementation, {
    kind: 'agent', prompt: 'prompts/brief.md', profile: 'restricted-generation',
    context: [{ requirement: 'activity', selector: 'previous-local-day' }], result: 'html-artifact',
  })
})

test('generation requests only projected conversation metadata and owned artifact publication', () => {
  assert.deepEqual(manifest.requires.activity, {
    capability: 'activity.read',
    scope: { source: 'conversation-metadata', fields: ['title', 'createdAt', 'updatedAt'], days: 1 },
  })
  assert.deepEqual(manifest.requires.generation, { capability: 'agent.run', scope: { profile: 'restricted-generation' } })
  assert.deepEqual(manifest.requires.reports, { capability: 'artifacts.write', scope: { owner: 'self' } })
  assert.deepEqual(manifest.requires.openReports, { capability: 'artifacts.open', scope: { owner: 'self' } })
  assert.deepEqual(manifest.provides.actions.generate.requires, ['activity', 'generation', 'reports'])
  assert.deepEqual(manifest.provides.actions.generate.contexts, ['app'])
})

test('schedule declaration is only a suggestion, with no enabled state or implicit delivery', () => {
  assert.deepEqual(manifest.provides.triggers.morning, {
    kind: 'schedule', action: 'generate', input: {}, suggested: { localTime: '08:30' },
  })
  assert.equal(manifest.instances.mode, 'single')
  validateAppValue(manifest.configurationSchema, { title: 'Brief', timeZone: 'America/Los_Angeles' })
  assert.throws(() => validateAppValue(manifest.configurationSchema, { title: 'Brief' }), { code: 'INVALID_ARGUMENT' })
  const changed = structuredClone(manifest)
  changed.provides.triggers.morning.enabled = true
  assert.throws(() => parseAppManifest(changed), { code: 'INVALID_ARGUMENT' })
})

test('result is an artifact ID, not report HTML or proof of opening a report', () => {
  const schema = manifest.provides.actions.generate.outputSchema
  // Schema sample only. No artifact is generated, published, or opened here.
  validateAppValue(schema, { artifactId: 'artifact_schema_sample' })
  for (const value of [{ html: '<h1>Not an artifact result</h1>' }, { artifactId: '' }, { artifactId: 'id', opened: true }]) {
    assert.throws(() => validateAppValue(schema, value), { code: 'INVALID_ARGUMENT' })
  }
})

test('the packaged prompt states data, HTML, no-network and separate-delivery constraints', async () => {
  const prompt = await readFile(new URL('../bundle/prompts/brief.md', import.meta.url), 'utf8')
  for (const pattern of [/untrusted\s+data/, /previous local calendar day/, /Escape all untrusted text/, /no scripts/i, /No tools, network/, /separate host operation/]) {
    assert.match(prompt, pattern)
  }
  // Text checks are not an agent safety evaluation. Native generation remains blocked.
  const metadata = parseAppJson(await readFile(new URL('../app.json', import.meta.url), 'utf8'))
  assert.equal(metadata.status, 'experimental')
  assert.equal(metadata.license, 'UNLICENSED')
  assert.deepEqual(metadata.screenshots, [])
})
