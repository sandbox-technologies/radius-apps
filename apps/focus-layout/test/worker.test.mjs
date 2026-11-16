import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseAppJson, parseAppManifest, validateAppValue } from '@radius/apps-sdk'
import { validateAppBundleFiles } from '@radius/apps-sdk/release'
import { split, splitAndDraft } from '../bundle/worker.js'

const manifest = parseAppManifest(parseAppJson(await readFile(new URL('../bundle/radius-app.json', import.meta.url), 'utf8')))

test('Focus Layout bundle keeps split and unavailable draft requirements separate', async () => {
  const files = Object.fromEntries(await Promise.all(['radius-app.json', 'worker.js'].map(async path => [path,
    (await readFile(new URL(`../bundle/${path}`, import.meta.url))).toString('base64'),
  ])))
  assert.equal(validateAppBundleFiles(files).manifest.id, 'dev.radius.focus-layout')
  assert.equal(manifest.instances.mode, 'none')
  assert.deepEqual(manifest.provides.actions.split.requires, ['layout'])
  assert.deepEqual(manifest.provides.actions.splitAndDraft.requires, ['layout', 'draft'])
  for (const action of Object.values(manifest.provides.actions)) assert.deepEqual(action.contexts, ['tab'])
  for (const requirement of Object.values(manifest.requires)) assert.deepEqual(requirement.scope, { target: 'invocation' })
  assert.deepEqual(manifest.provides.views, {})
  assert.deepEqual(manifest.provides.triggers, {})
  assert.match(manifest.provides.actions.splitAndDraft.description, /unavailable before admission/)
})

test('split worker makes one public host call without choosing a tab or sending a message', async () => {
  const calls = []
  const result = await split({}, { host: { async call(method, input) { calls.push({ method, input }); return {} } } })
  assert.deepEqual(calls, [{ method: 'tabs.split', input: { direction: 'right' } }])
  assert.deepEqual(result, { split: true })
  validateAppValue(manifest.provides.actions.split.outputSchema, result)
})

test('split denial is propagated without retry', async () => {
  const error = Object.assign(new Error('Mock captured target expired'), { code: 'TARGET_EXPIRED' })
  let calls = 0
  await assert.rejects(split({}, { host: { async call() { calls++; throw error } } }), failure => failure === error)
  assert.equal(calls, 1)
})

test('draft worker contract against a hypothetical future port, NOT native draft support', async () => {
  const calls = []
  const input = { text: 'An unsent draft' }
  validateAppValue(manifest.provides.actions.splitAndDraft.inputSchema, input)
  const result = await splitAndDraft(input, { host: { async call(method, input) { calls.push({ method, input }); return {} } } })
  assert.deepEqual(calls, [
    { method: 'tabs.split', input: { direction: 'right' } },
    { method: 'chat.createDraft', input: { text: input.text } },
  ])
  assert.deepEqual(result, { split: true, draft: true })
  validateAppValue(manifest.provides.actions.splitAndDraft.outputSchema, result)
})

test('a mock future draft failure retains the split and does not replay it', async () => {
  let committedSplits = 0
  const calls = []
  const denied = Object.assign(new Error('Mock draft destination expired'), { code: 'TARGET_EXPIRED' })
  await assert.rejects(splitAndDraft({ text: 'Draft' }, { host: { async call(method) {
    calls.push(method)
    if (method === 'tabs.split') { committedSplits++; return {} }
    throw denied
  } } }), error => error === denied)
  assert.equal(committedSplits, 1)
  assert.deepEqual(calls, ['tabs.split', 'chat.createDraft'])
})

test('failed split does not attempt the hypothetical draft port', async () => {
  const calls = []
  await assert.rejects(splitAndDraft({ text: 'Draft' }, { host: { async call(method) {
    calls.push(method)
    throw Object.assign(new Error('Mock unavailable split'), { code: 'CAPABILITY_UNAVAILABLE' })
  } } }), { code: 'CAPABILITY_UNAVAILABLE' })
  assert.deepEqual(calls, ['tabs.split'])
})
