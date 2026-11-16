import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildApps, createApp, installGuidance, runCli, validateApps, validateMetadata, validateSlug } from '../tooling/apps.mjs';
import { removeOwnedTree, snapshotBundle, snapshotDirectoryFiles, writeSnapshotFiles } from '../tooling/bundle.mjs';
import { validateActionInput, validateActionOutput, validateConfiguration } from '../tooling/testing.mjs';

const cli = fileURLToPath(new URL('../tooling/apps.mjs', import.meta.url));
const metadata = (slug = 'demo') => ({
  schemaVersion: 1, slug, title: 'Demo', summary: 'A local development app.', status: 'experimental',
  license: 'UNLICENSED', authors: [{ name: 'Contributor' }], categories: ['testing'], screenshots: [],
});
const manifest = (id = 'test.demo') => ({
  schemaVersion: 2, apiVersion: 'radius.apps/1', id, name: 'Demo', version: '0.1.0',
  instances: { mode: 'none', stateSchemaVersion: 1 },
  provides: { views: { main: { title: 'Demo', entry: 'ui/index.html', placement: 'tab' } } },
});

async function json(path, value) { await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }

async function writeApp(directory, slug = 'demo', id = `test.${slug}`) {
  await fs.mkdir(join(directory, 'bundle/ui'), { recursive: true });
  await fs.mkdir(join(directory, 'test'));
  await json(join(directory, 'app.json'), metadata(slug));
  await json(join(directory, 'bundle/radius-app.json'), manifest(id));
  await fs.writeFile(join(directory, 'bundle/ui/index.html'), '<!doctype html><title>Demo</title>');
  await fs.writeFile(join(directory, 'bundle/never-run.mjs'), 'throw new Error("DO NOT EXECUTE APP CODE");');
  await fs.writeFile(join(directory, 'README.md'), '# Demo\n\nTemplate instructions.\n');
  await fs.writeFile(join(directory, 'CHANGELOG.md'), '# Changelog\n\n## 0.1.0\n\nInitial scaffold.\n');
  await fs.writeFile(join(directory, 'test/safety.test.mjs'), 'throw new Error("VALIDATE AND BUILD MUST NOT RUN APP TESTS");');
}

async function fixture(t, { empty = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "radius-authoring quote'-")));
  t.after(() => removeOwnedTree(root));
  await fs.mkdir(join(root, 'apps'));
  await fs.mkdir(join(root, 'templates'));
  if (!empty) await writeApp(join(root, 'apps/demo'));
  for (const template of ['interactive', 'background-action', 'scheduled-agent']) {
    await writeApp(join(root, 'templates', template), template, `test.${template}`);
  }
  return root;
}

test('local metadata accepts absent screenshots/license but validates every present key', () => {
  const value = metadata();
  delete value.license;
  delete value.screenshots;
  assert.deepEqual(validateMetadata(value, 'demo'), value);
  assert.equal(validateMetadata(metadata(), 'demo').license, 'UNLICENSED');
  for (const license of ['MIT', 'Apache-2.0', 'LicenseRef-Owner-Choice', 'MIT OR Apache-2.0']) assert.equal(validateMetadata({ ...metadata(), license }).license, license);
  for (const update of [
    { schemaVersion: 2 }, { slug: '../escape' }, { slug: 'not-demo' }, { title: '' }, { summary: 'x'.repeat(1001) },
    { status: 'published' }, { license: '' }, { license: ' ' }, { license: 'x'.repeat(129) }, { license: { id: 'MIT' } }, { scripts: { postinstall: 'run-me' } },
    { authors: [] }, { authors: [{ name: 'Someone', email: 'extra@example.test' }] }, { authors: [{ name: 'Same' }, { name: 'same' }] },
    { categories: ['one', 'one'] }, { categories: ['Bad Category'] },
    { screenshots: ['../outside.png'] }, { screenshots: ['https://example.test/a.png'] },
    { screenshots: ['one.png', 'ONE.png'] }, { screenshots: ['script.svg'] },
  ]) assert.throws(() => validateMetadata({ ...metadata(), ...update }, 'demo'), { name: 'AppContractError' });
  assert.throws(() => validateMetadata({ ...metadata(), title: '\u001b[1m' }), /Invalid metadata title/);
  assert.throws(() => validateMetadata({ ...metadata(), title: '\ud800' }), /surrogate/);
});

test('slugs are bounded, path-safe and portable', () => {
  for (const valid of ['a', 'demo-2', `a${'b'.repeat(63)}`]) assert.equal(validateSlug(valid), valid);
  for (const invalid of ['', '.', '..', '../escape', '/absolute', 'nested/name', 'back\\slash', 'UPPER', '1first', '-first', 'last-', 'two--hyphens', 'foo_bar', 'con', 'constructor', 'prototype', 'caf\u00e9', `a${'b'.repeat(64)}`]) assert.throws(() => validateSlug(invalid));
});

test('validate scopes assets to the selected app and checks duplicate IDs repository-wide', async (t) => {
  const root = await fixture(t);
  await writeApp(join(root, 'apps/second'), 'second');
  assert.deepEqual((await validateApps(root)).map((app) => app.slug), ['demo', 'second']);
  await fs.unlink(join(root, 'apps/second/bundle/ui/index.html'));
  assert.equal((await validateApps(root, 'demo')).length, 1);
  await assert.rejects(validateApps(root), /Missing bundle entry/);
  await json(join(root, 'apps/second/bundle/radius-app.json'), manifest('test.demo'));
  await assert.rejects(validateApps(root, 'demo'), /Duplicate app ID/);
});

test('metadata duplicate JSON keys, unknown fields, oversized files and links fail closed', async (t) => {
  const cases = [
    ['duplicate', async (path) => fs.writeFile(path, `{"slug":"extra",${JSON.stringify(metadata()).slice(1)}`), /Duplicate JSON key/],
    ['unknown', async (path) => json(path, { ...metadata(), grants: ['everything'] }), /Unsupported metadata field/],
    ['large', async (path) => fs.writeFile(path, ' '.repeat(64 * 1024 + 1)), /byte limit/],
    ['symlink', async (path, root) => { await fs.rename(path, join(root, 'metadata.json')); await fs.symlink(join(root, 'metadata.json'), path); }, /regular file/],
    ['hardlink', async (path, root) => fs.link(path, join(root, 'linked.json')), /hard links/],
  ];
  for (const [name, change, pattern] of cases) await t.test(name, async (t) => {
    const root = await fixture(t);
    await change(join(root, 'apps/demo/app.json'), root);
    await assert.rejects(validateApps(root), pattern);
    await assert.rejects(buildApps(root), pattern);
    await assert.rejects(fs.lstat(join(root, 'dist')), { code: 'ENOENT' });
  });
});

test('app directory symlinks and bundle directory symlinks are not followed', async (t) => {
  for (const part of ['apps', 'apps/demo', 'apps/demo/bundle']) await t.test(part, async (t) => {
    const root = await fixture(t);
    const path = join(root, part);
    const moved = join(root, 'moved');
    await fs.rename(path, moved);
    await fs.symlink(moved, path);
    await assert.rejects(validateApps(root), /real directory/);
  });
});

test('build publishes bundle files only, read-only and deterministically, without executing code', async (t) => {
  const root = await fixture(t);
  await writeApp(join(root, 'apps/second'), 'second');
  const built = await buildApps(root);
  assert.equal(built.length, 2);
  for (const app of built) {
    assert.equal(app.output, join(root, 'dist/apps', app.slug));
    assert.equal((await snapshotBundle(app.output)).digest, app.digest);
    assert.deepEqual((await fs.readdir(app.output)).sort(), ['never-run.mjs', 'radius-app.json', 'ui']);
    assert.equal((await fs.stat(app.output)).mode & 0o222, 0);
    assert.equal((await fs.stat(join(app.output, 'radius-app.json'))).mode & 0o222, 0);
    for (const excluded of ['app.json', 'README.md', 'CHANGELOG.md', 'test']) await assert.rejects(fs.lstat(join(app.output, excluded)), { code: 'ENOENT' });
  }
  const before = await fs.stat(built[0].output);
  const again = await buildApps(root, 'demo');
  assert.equal(again[0].digest, built[0].digest);
  assert.equal((await fs.stat(again[0].output)).ino, before.ino);
  assert.deepEqual((await fs.readdir(join(root, 'dist/apps'))).sort(), ['demo', 'second']);
});

test('all-app build validates all inputs before writing any output', async (t) => {
  const root = await fixture(t);
  await writeApp(join(root, 'apps/zz-broken'), 'zz-broken');
  await fs.unlink(join(root, 'apps/zz-broken/bundle/ui/index.html'));
  await assert.rejects(buildApps(root), /Missing bundle entry/);
  await assert.rejects(fs.lstat(join(root, 'dist')), { code: 'ENOENT' });
});

test('rebuild replaces a complete immutable snapshot and leaves no partial staging trees', async (t) => {
  const root = await fixture(t);
  const [before] = await buildApps(root, 'demo');
  await fs.writeFile(join(root, 'apps/demo/bundle/ui/index.html'), '<title>Changed</title>');
  const [after] = await buildApps(root, 'demo');
  assert.notEqual(before.digest, after.digest);
  assert.equal((await snapshotBundle(after.output)).digest, after.digest);
  assert.deepEqual(await fs.readdir(join(root, 'dist/apps')), ['demo']);
});

test('publication failure restores the previous build and cleans owned staging', async (t) => {
  const root = await fixture(t);
  const [before] = await buildApps(root, 'demo');
  await fs.writeFile(join(root, 'apps/demo/bundle/ui/index.html'), '<title>Changed</title>');
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (source.includes('.demo.pending-') && destination === before.output) throw Object.assign(new Error('simulated publish failure'), { code: 'EIO' });
    return rename(source, destination);
  });
  await assert.rejects(buildApps(root, 'demo'), /simulated publish failure/);
  assert.equal((await snapshotBundle(before.output)).digest, before.digest);
  assert.deepEqual(await fs.readdir(join(root, 'dist/apps')), ['demo']);
});

test('build uses snapshotted bytes even if source changes after validation', async (t) => {
  const root = await fixture(t);
  const before = await snapshotBundle(join(root, 'apps/demo/bundle'));
  const mkdtemp = fs.mkdtemp;
  t.mock.method(fs, 'mkdtemp', async (path, ...rest) => {
    if (path.includes('.demo.pending-')) await fs.writeFile(join(root, 'apps/demo/bundle/ui/index.html'), '<title>After validation</title>');
    return mkdtemp(path, ...rest);
  });
  const [built] = await buildApps(root, 'demo');
  assert.equal(built.digest, before.digest);
  assert.equal((await snapshotBundle(built.output)).digest, before.digest);
  assert.notEqual((await snapshotBundle(join(root, 'apps/demo/bundle'))).digest, before.digest);
});

test('output symlinks and existing build locks are refused without changing their targets', async (t) => {
  for (const part of ['dist', 'dist/apps', 'dist/apps/demo']) await t.test(part, async (t) => {
    const root = await fixture(t);
    await fs.mkdir(join(root, 'dist/apps'), { recursive: true });
    if (part !== 'dist/apps/demo') await fs.rmdir(join(root, 'dist/apps'));
    if (part === 'dist') await fs.rmdir(join(root, 'dist'));
    const outside = join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(join(outside, 'keep.txt'), 'do not touch');
    await fs.symlink(outside, join(root, part));
    await assert.rejects(buildApps(root), /real directory/);
    assert.deepEqual(await fs.readdir(outside), ['keep.txt']);
    assert.equal(await fs.readFile(join(outside, 'keep.txt'), 'utf8'), 'do not touch');
  });
  await t.test('lock', async (t) => {
    const root = await fixture(t);
    await fs.mkdir(join(root, 'dist/apps/.demo.build-lock'), { recursive: true });
    await assert.rejects(buildApps(root), /Build lock exists/);
    assert.deepEqual(await fs.readdir(join(root, 'dist/apps')), ['.demo.build-lock']);
  });
});

test('create copies each provided template, adjusts identity, and creates only a new app directory', async (t) => {
  const root = await fixture(t);
  for (const template of ['interactive', 'background-action', 'scheduled-agent']) {
    const slug = `new-${template}`;
    const created = await createApp(root, slug, template);
    assert.equal(created.manifest.id, `local.${slug}`);
    assert.equal(created.metadata.slug, slug);
    assert.equal(created.metadata.license, 'UNLICENSED');
    assert.equal(created.manifest.name, created.metadata.title);
    assert.equal(created.manifest.provides.views.main.title, created.metadata.title);
    assert.equal((await validateApps(root, slug))[0].manifest.id, `local.${slug}`);
    assert.equal(await fs.readFile(join(created.directory, 'bundle/never-run.mjs'), 'utf8'), 'throw new Error("DO NOT EXECUTE APP CODE");');
    assert.match(await fs.readFile(join(created.directory, 'README.md'), 'utf8'), /^# New /);
    const before = await fs.readFile(join(created.directory, 'app.json'), 'utf8');
    await assert.rejects(createApp(root, slug, template), /already exists/);
    assert.equal(await fs.readFile(join(created.directory, 'app.json'), 'utf8'), before);
  }
  await assert.rejects(fs.lstat(join(root, 'dist')), { code: 'ENOENT' });
});

test('create also supports a bundle-only template without contributor metadata or tests', async (t) => {
  const root = await fixture(t);
  const template = join(root, 'templates/interactive');
  for (const name of ['app.json', 'README.md', 'CHANGELOG.md', 'test']) await removeOwnedTree(join(template, name));
  const created = await createApp(root, 'bundle-only', 'interactive');
  assert.equal(created.metadata.authors[0].name, 'Your name');
  assert.ok((await fs.readFile(join(created.directory, 'test/contract.test.mjs'), 'utf8')).includes('not a security sandbox'));
  assert.equal((await validateApps(root, 'bundle-only')).length, 1);
});

test('create preserves an explicitly selected template license; missing license defaults to UNLICENSED', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'templates/interactive/app.json');
  await json(path, { ...metadata('interactive'), license: 'LicenseRef-Owner-Choice' });
  const selected = await createApp(root, 'selected-license', 'interactive');
  assert.equal(selected.metadata.license, 'LicenseRef-Owner-Choice');
  assert.equal((await buildApps(root, 'selected-license'))[0].metadata.license, 'LicenseRef-Owner-Choice');
  const missing = metadata('interactive');
  delete missing.license;
  await json(path, missing);
  assert.equal((await createApp(root, 'missing-license', 'interactive')).metadata.license, 'UNLICENSED');
});

test('create bad arguments, invalid templates and duplicate IDs write no new files', async (t) => {
  const root = await fixture(t);
  const before = await fs.readdir(join(root, 'apps'));
  for (const [slug, template] of [['../escape', 'interactive'], ['new-app', '../interactive'], ['new-app', 'unknown'], ['con', 'interactive']]) await assert.rejects(createApp(root, slug, template));
  await json(join(root, 'templates/interactive/bundle/radius-app.json'), { ...manifest(), schemaVersion: 9 });
  await assert.rejects(createApp(root, 'new-app', 'interactive'), /Unsupported app schema/);
  await json(join(root, 'apps/demo/bundle/radius-app.json'), manifest('local.new-app'));
  await assert.rejects(createApp(root, 'new-app', 'background-action'), /Duplicate app ID/);
  assert.deepEqual(await fs.readdir(join(root, 'apps')), before);
  assert.deepEqual((await fs.readdir(root)).sort(), ['apps', 'templates']);
});

test('create refuses an existing empty destination instead of adopting it', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(join(root, 'apps/existing'));
  await assert.rejects(createApp(root, 'existing', 'interactive'), /already exists/);
  assert.deepEqual(await fs.readdir(join(root, 'apps/existing')), []);
});

test('create detects generated metadata path collisions before creating the destination', async (t) => {
  const root = await fixture(t);
  const template = join(root, 'templates/interactive');
  await fs.unlink(join(template, 'app.json'));
  await fs.mkdir(join(template, 'app.json'));
  await fs.writeFile(join(template, 'app.json/child.txt'), 'not metadata');
  let writes = 0;
  const mkdir = fs.mkdir;
  t.mock.method(fs, 'mkdir', (...args) => { writes++; return mkdir(...args); });
  await assert.rejects(createApp(root, 'bad-map', 'interactive'), /file\/directory path collision/);
  assert.equal(writes, 0);
  assert.deepEqual(await fs.readdir(join(root, 'apps')), ['demo']);
});

test('the real provided templates scaffold, validate, build and pass their trusted Node tests', async (t) => {
  const root = await fixture(t, { empty: true });
  const repo = fileURLToPath(new URL('..', import.meta.url));
  // Only a test fixture links the already-installed local SDK. Authoring create
  // never installs packages, creates node_modules, or runs these app tests.
  await json(join(root, 'package.json'), { private: true, type: 'module' });
  await fs.symlink(join(repo, 'node_modules'), join(root, 'node_modules'));
  const testFiles = [];
  for (const template of ['interactive', 'background-action', 'scheduled-agent']) {
    const destination = join(root, 'templates', template);
    await removeOwnedTree(destination);
    await fs.mkdir(destination);
    await writeSnapshotFiles(destination, await snapshotDirectoryFiles(join(repo, 'templates', template)));
    const created = await createApp(root, `real-${template}`, template);
    assert.equal(created.manifest.id, `local.real-${template}`);
    assert.equal(created.metadata.license, 'MIT');
    for (const name of await fs.readdir(join(created.directory, 'test'))) if (name.endsWith('.test.mjs')) testFiles.push(join(created.directory, 'test', name));
  }
  assert.equal((await validateApps(root)).length, 3);
  assert.equal((await buildApps(root)).length, 3);
  const tests = spawnSync(process.execPath, ['--test', ...testFiles], { cwd: root, encoding: 'utf8', timeout: 20_000 });
  assert.equal(tests.status, 0, `${tests.stdout}\n${tests.stderr}`);
});

test('install prints shell-quoted, digest-pinned, zero-grant review/install guidance only', async (t) => {
  const root = await fixture(t);
  const lines = [];
  await runCli(['install', 'demo'], { root, log: (value) => lines.push(value) });
  const output = lines.join('\n');
  assert.match(output, /Nothing was installed/);
  assert.match(output, /radius apps call apps\.review --input '/);
  assert.match(output, /radius apps install '/);
  assert.match(output, /--expected-digest [a-f0-9]{64} --grant '' --allow-agent-invocation false --json/);
  assert.ok(output.includes("'\\''"), 'apostrophes in paths must be shell-escaped');
  assert.ok(!output.includes('--launch'));
  assert.ok(!output.includes('triggers.configure'));
  assert.deepEqual((await fs.readdir(root)).sort(), ['apps', 'dist', 'templates']);
  const [built] = await buildApps(root, 'demo');
  assert.equal(lines[0], installGuidance(built));
});

test('CLI has documented signatures and rejects unknown/extra flags before writes', async (t) => {
  const root = await fixture(t);
  const output = [];
  await runCli(['--help'], { root, log: (line) => output.push(line) });
  assert.match(output[0], /create <slug> --template interactive\|background-action\|scheduled-agent/);
  for (const args of [
    ['unknown'], ['install'], ['build', 'demo', '--grant', 'all'], ['validate', '--json'],
    ['create', 'new-app'], ['create', 'new-app', '--template', 'interactive', '--force'], ['install', 'demo', '--launch'],
  ]) await assert.rejects(runCli(args, { root, log: () => {} }));
  assert.deepEqual((await fs.readdir(root)).sort(), ['apps', 'templates']);
});

test('Node entry point returns useful exit status and works with no external commands on PATH', async (t) => {
  const root = await fixture(t);
  const options = { cwd: root, encoding: 'utf8', timeout: 10_000, env: { ...process.env, PATH: join(root, 'no-executables') } };
  const validate = spawnSync(process.execPath, [cli, 'validate'], options);
  assert.equal(validate.status, 0, validate.stderr);
  assert.match(validate.stdout, /Validated demo/);
  const install = spawnSync(process.execPath, [cli, 'install', 'demo'], options);
  assert.equal(install.status, 0, install.stderr);
  assert.match(install.stdout, /Nothing was installed/);
  const invalid = spawnSync(process.execPath, [cli, 'create', '../bad', '--template', 'interactive'], options);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /INVALID_ARGUMENT: Invalid app slug/);
  assert.ok(!invalid.stderr.includes('\n    at '));
});

test('empty catalog validates/builds without materializing empty dist output', async (t) => {
  const root = await fixture(t, { empty: true });
  assert.deepEqual(await validateApps(root), []);
  assert.deepEqual(await buildApps(root), []);
  await assert.rejects(fs.lstat(join(root, 'dist')), { code: 'ENOENT' });
  const lines = [];
  await runCli(['validate'], { root, log: (line) => lines.push(line) });
  assert.deepEqual(lines, ['No apps found.']);
});

test('test helpers validate values only and reject unknown actions without coercion', () => {
  const closed = { type: 'object', properties: { count: { type: 'integer', minimum: 0 } }, required: ['count'], additionalProperties: false };
  const value = {
    ...manifest(), worker: { entry: 'worker.js' }, configurationSchema: closed,
    provides: { actions: { run: { title: 'Run', contexts: ['app'], inputSchema: closed, outputSchema: { type: 'boolean' }, requires: [], implementation: { kind: 'handler', export: 'run' } } } },
  };
  assert.equal(validateActionInput(value, 'run', { count: 0 }), undefined);
  assert.equal(validateActionOutput(value, 'run', true), undefined);
  assert.equal(validateConfiguration(value, { count: 2 }), undefined);
  assert.throws(() => validateActionInput(value, 'run', { count: '0' }));
  assert.throws(() => validateActionInput(value, 'run', { count: 0, extra: true }));
  assert.throws(() => validateActionOutput(value, 'run', 1));
  assert.throws(() => validateActionInput(value, 'constructor', { count: 0 }), /Unknown app action/);
});
