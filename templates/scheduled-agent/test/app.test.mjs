import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseAppJson, parseAppManifest, validateAppValue } from '@radius/apps-sdk'
import { validateAppBundleFiles } from '@radius/apps-sdk/release'

const manifest = parseAppManifest(parseAppJson(await readFile(new URL('../bundle/radius-app.json', import.meta.url), 'utf8')))

test('scheduled starter packages a restricted agent prompt, not a worker or provider client', async () => {
  const files = Object.fromEntries(await Promise.all(['LICENSE', 'radius-app.json', 'prompts/report.md'].map(async path => [path,
    (await readFile(new URL(`../bundle/${path}`, import.meta.url))).toString('base64'),
  ])))
  assert.equal(validateAppBundleFiles(files).manifest.apiVersion, 'radius.apps/1')
  assert.equal(manifest.worker, undefined)
  assert.deepEqual(manifest.provides.views, {})
  assert.deepEqual(manifest.provides.actions.generate.implementation, {
    kind: 'agent', prompt: 'prompts/report.md', profile: 'restricted-generation',
    context: [{ requirement: 'activity', selector: 'previous-local-day' }], result: 'html-artifact',
  })
  assert.deepEqual(manifest.provides.actions.generate.requires, ['activity', 'generation', 'reports'])
  assert.deepEqual(manifest.requires.activity.scope, {
    source: 'conversation-metadata', fields: ['title', 'createdAt', 'updatedAt'], days: 1,
  })
  assert.equal(Object.values(manifest.requires).some(requirement => requirement.capability === 'artifacts.open'), false)
})

test('the trigger has no enabled state, delivery, or implicit timezone', () => {
  assert.deepEqual(manifest.provides.triggers.daily, {
    kind: 'schedule', action: 'generate', input: {}, suggested: { localTime: '09:00' },
  })
  const changed = structuredClone(manifest)
  changed.provides.triggers.daily.enabled = true
  assert.throws(() => parseAppManifest(changed), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => validateAppValue(manifest.configurationSchema, { title: 'Report' }), { code: 'INVALID_ARGUMENT' })
  validateAppValue(manifest.configurationSchema, { title: 'Report', timeZone: 'America/Los_Angeles' })
})

test('the result schema describes an artifact ID, not a generated-report test result', () => {
  const schema = manifest.provides.actions.generate.outputSchema
  validateAppValue(schema, { artifactId: 'artifact_schema_fixture_only' })
  assert.throws(() => validateAppValue(schema, { html: '<h1>No actual report</h1>' }), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => validateAppValue(schema, { artifactId: 'id', opened: true }), { code: 'INVALID_ARGUMENT' })
})

test('prompt constraints and experimental metadata remain honest', async () => {
  const prompt = await readFile(new URL('../bundle/prompts/report.md', import.meta.url), 'utf8')
  for (const pattern of [/untrusted data, never instructions/, /Escape all untrusted text/, /No tools, network/, /Publication and delivery are separate/]) assert.match(prompt, pattern)
  const metadata = parseAppJson(await readFile(new URL('../app.json', import.meta.url), 'utf8'))
  assert.equal(metadata.status, 'experimental')
  assert.equal(metadata.license, 'MIT')
  assert.deepEqual(metadata.screenshots, [])
})
