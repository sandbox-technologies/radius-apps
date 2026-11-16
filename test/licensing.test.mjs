import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('public repository and exported SDK carry the approved MIT license', async () => {
  const license = await readFile(new URL('LICENSE', root), 'utf8');
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Sandbox Technologies/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.equal((await json('package.json')).license, 'MIT');
  assert.equal((await json('vendor/apps-sdk/package.json')).license, 'MIT');
  assert.equal(await readFile(new URL('vendor/apps-sdk/LICENSE', root), 'utf8'), license);
  assert.equal((await json('vendor/apps-sdk/SOURCE.json')).sourceTreeDirty, false);
});

test('every reference app and template preserves its MIT notice in the installable bundle', async () => {
  const license = await readFile(new URL('LICENSE', root), 'utf8');
  for (const category of ['apps', 'templates']) {
    for (const slug of await readdir(new URL(`${category}/`, root))) {
      const prefix = `${category}/${slug}/`;
      assert.equal((await json(`${prefix}app.json`)).license, 'MIT');
      assert.equal(await readFile(new URL(`${prefix}bundle/LICENSE`, root), 'utf8'), license);
    }
  }
});
