import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { getRadiusApp, parseAppJson, canonicalAppJson } from '@radius/apps-sdk'

test('vendored public SDK output hashes match the recorded distribution', async () => {
  const root = new URL('../vendor/apps-sdk/', import.meta.url)
  const source = JSON.parse(await readFile(new URL('SOURCE.json', root), 'utf8'))
  assert.match(source.commit, /^[a-f0-9]{40}$/)
  assert.equal(source.apiVersion, 'radius.apps/1')
  for (const [path, digest] of Object.entries(source.outputs)) {
    assert(!path.startsWith('/') && !path.split('/').includes('..'))
    assert.equal(createHash('sha256').update(await readFile(new URL(path, root))).digest('hex'), digest, path)
  }
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(pkg.scripts, undefined)
  assert.equal(pkg.dependencies, undefined)
})

test('public JSON helpers reject duplicate/prototype keys and canonicalize data', () => {
  assert.throws(() => parseAppJson('{"x":1,"x":2}'))
  assert.throws(() => parseAppJson('{"__proto__":{}}'))
  assert.equal(canonicalAppJson({ z: 1, a: 2 }), '{"a":2,"z":1}')
})

test('view SDK never supplies a fake host outside Radius', () => {
  assert.throws(() => getRadiusApp(), { code: 'CAPABILITY_UNAVAILABLE' })
})
