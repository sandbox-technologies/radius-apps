import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { APP_LIMITS, canonicalAppJson } from '@radius/apps-sdk';
import { validateAppBundleFiles } from '@radius/apps-sdk/release';
import { readBoundedFile, removeOwnedTree, snapshotBundle, snapshotDirectoryFiles, validateDirectoryFiles, writeSnapshotFiles } from '../tooling/bundle.mjs';

const manifest = () => ({
  schemaVersion: 2, apiVersion: 'radius.apps/1', id: 'test.bundle', name: 'Bundle', version: '0.1.0',
  instances: { mode: 'none', stateSchemaVersion: 1 },
  provides: { views: { main: { title: 'Bundle', entry: 'ui/index.html', placement: 'tab' } } },
});

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'radius-bundle-test-')));
  t.after(() => removeOwnedTree(directory));
  const bundle = join(directory, 'bundle');
  await fs.mkdir(join(bundle, 'ui'), { recursive: true });
  await fs.writeFile(join(bundle, 'radius-app.json'), `${JSON.stringify(manifest(), null, 2)}\n`);
  await fs.writeFile(join(bundle, 'ui/index.html'), '<!doctype html><title>Bundle</title>');
  return { directory, bundle };
}

test('snapshot has exactly the host canonical filemap/digest, preserving original bytes', async (t) => {
  const { bundle } = await fixture(t);
  await fs.writeFile(join(bundle, 'binary.png'), Buffer.from([0, 255, 13, 10]));
  const result = await snapshotBundle(bundle);
  assert.deepEqual(Object.keys(result).sort(), ['digest', 'files', 'manifest']);
  assert.deepEqual(result, validateAppBundleFiles(result.files));
  assert.equal(result.digest, createHash('sha256').update(canonicalAppJson(result.files)).digest('hex'));
  assert.equal(Buffer.from(result.files['radius-app.json'], 'base64').toString(), await fs.readFile(join(bundle, 'radius-app.json'), 'utf8'));
  assert.deepEqual(Buffer.from(result.files['binary.png'], 'base64'), Buffer.from([0, 255, 13, 10]));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.files) && Object.isFrozen(result.manifest.provides));
  assert.throws(() => { result.files['extra.txt'] = ''; }, TypeError);
  assert.equal((await snapshotBundle(bundle)).digest, result.digest);
});

test('snapshot and materialization never execute app code', async (t) => {
  const { directory, bundle } = await fixture(t);
  await fs.writeFile(join(bundle, 'dangerous.mjs'), 'throw new Error("APP CODE MUST NOT RUN"); process.exit(73);');
  const result = await snapshotBundle(bundle);
  const output = join(directory, 'out');
  await fs.mkdir(output);
  await writeSnapshotFiles(output, result.files, { readonly: true });
  assert.equal((await snapshotBundle(output)).digest, result.digest);
  assert.equal((await fs.stat(output)).mode & 0o222, 0);
  assert.equal((await fs.stat(join(output, 'dangerous.mjs'))).mode & 0o222, 0);
});

test('rejects root, file, directory and dangling symlinks', async (t) => {
  for (const kind of ['root', 'file', 'directory', 'dangling']) {
    await t.test(kind, async (t) => {
      const { directory, bundle } = await fixture(t);
      const link = kind === 'root' ? join(directory, 'linked') : join(bundle, 'linked');
      const target = kind === 'file' ? join(bundle, 'radius-app.json') : kind === 'dangling' ? join(directory, 'missing') : bundle;
      await fs.symlink(target, link);
      await assert.rejects(snapshotBundle(kind === 'root' ? link : bundle), /symlink|regular file|real.*directory/i);
    });
  }
});

test('rejects hardlinked files, including an externally linked manifest', async (t) => {
  const { directory, bundle } = await fixture(t);
  await fs.link(join(bundle, 'radius-app.json'), join(directory, 'external-manifest'));
  await assert.rejects(snapshotBundle(bundle), /hard links/);
});

test('rejects FIFO without blocking', { timeout: 3000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX FIFO test');
  const { bundle } = await fixture(t);
  const fifo = join(bundle, 'pipe');
  const result = spawnSync('mkfifo', [fifo]);
  assert.equal(result.status, 0, result.stderr?.toString());
  await assert.rejects(snapshotBundle(bundle), /regular file/);
});

test('a FIFO substituted after lstat uses O_NONBLOCK and fails closed', { timeout: 3000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX FIFO test');
  const { bundle } = await fixture(t);
  const path = join(bundle, 'swap.txt');
  await fs.writeFile(path, 'old');
  const original = fs.open;
  let raced = false;
  t.mock.method(fs, 'open', async (target, flags, ...rest) => {
    if (target === path && !raced) {
      raced = true;
      assert.ok(flags & constants.O_NONBLOCK);
      assert.ok(flags & constants.O_NOFOLLOW);
      await fs.unlink(path);
      assert.equal(spawnSync('mkfifo', [path]).status, 0);
    }
    return original(target, flags, ...rest);
  });
  await assert.rejects(readBoundedFile(path, 100), /regular file/);
  assert.ok(raced);
});

test('a symlink substituted after lstat is not followed', async (t) => {
  const { directory, bundle } = await fixture(t);
  const path = join(bundle, 'swap.txt');
  const outside = join(directory, 'private.txt');
  await fs.writeFile(path, 'old');
  await fs.writeFile(outside, 'private bytes');
  const original = fs.open;
  let raced = false;
  t.mock.method(fs, 'open', async (target, ...rest) => {
    if (target === path && !raced) { raced = true; await fs.unlink(path); await fs.symlink(outside, path); }
    return original(target, ...rest);
  });
  await assert.rejects(readBoundedFile(path, 100));
  assert.ok(raced);
});

test('detects same-size edits while reading, even if mtime is restored', async (t) => {
  const { bundle } = await fixture(t);
  const path = join(bundle, 'change.txt');
  await fs.writeFile(path, 'first');
  const before = await fs.stat(path);
  const original = fs.open;
  let changed = false;
  t.mock.method(fs, 'open', async (target, ...rest) => {
    const handle = await original(target, ...rest);
    if (target === path && !changed) {
      const read = handle.read.bind(handle);
      handle.read = async (...args) => {
        const result = await read(...args);
        if (!changed) {
          changed = true;
          await fs.writeFile(path, 'other');
          await fs.utimes(path, before.atime, before.mtime);
        }
        return result;
      };
    }
    return handle;
  });
  await assert.rejects(snapshotBundle(bundle), /changed/);
  assert.ok(changed);
});

test('detects changes between the two full snapshot passes', async (t) => {
  const { bundle } = await fixture(t);
  const path = join(bundle, 'ui/index.html');
  const original = fs.open;
  let rootOpens = 0;
  t.mock.method(fs, 'open', async (target, flags, ...rest) => {
    const handle = await original(target, flags, ...rest);
    if (target === bundle && (flags & constants.O_DIRECTORY) && ++rootOpens === 2) {
      // Contents change without changing the root directory's membership.
      await fs.writeFile(path, '<!doctype html><title>Edited</title>');
    }
    return handle;
  });
  await assert.rejects(snapshotBundle(bundle), /changed between snapshot passes/);
  assert.equal(rootOpens, 2);
});

test('enforces per-file, aggregate, file-count and tree-depth limits', async (t) => {
  await t.test('sparse oversize file', async (t) => {
    const { bundle } = await fixture(t);
    const path = join(bundle, 'oversize.bin');
    await fs.writeFile(path, '');
    await fs.truncate(path, APP_LIMITS.bundleFileBytes + 1);
    await assert.rejects(snapshotBundle(bundle), /byte limit/);
  });
  await t.test('aggregate before allocating next file', async (t) => {
    const { bundle } = await fixture(t);
    for (const name of ['a.bin', 'b.bin', 'c.bin']) {
      const path = join(bundle, name);
      await fs.writeFile(path, '');
      await fs.truncate(path, APP_LIMITS.bundleFileBytes - 1024);
    }
    await assert.rejects(snapshotBundle(bundle), /expanded byte limit/);
  });
  await t.test('file count', async (t) => {
    const { bundle } = await fixture(t);
    await Promise.all(Array.from({ length: APP_LIMITS.bundleFiles }, (_, index) => fs.writeFile(join(bundle, `f${index}.txt`), '')));
    await assert.rejects(snapshotBundle(bundle), /Too many bundle files/);
  });
  await t.test('depth', async (t) => {
    const { bundle } = await fixture(t);
    await fs.mkdir(join(bundle, ...Array(17).fill('nested')), { recursive: true });
    await assert.rejects(snapshotBundle(bundle), /Invalid bundle path/);
  });
});

test('rejects portable-path aliases and reserved filenames', async (t) => {
  for (const name of ['bad name.txt', 'bad%20name.txt', 'bad\\name.txt', 'con.txt', 'constructor', 'trailing.', 'caf\u00e9.txt']) {
    await t.test(name, async (t) => {
      const { bundle } = await fixture(t);
      await fs.writeFile(join(bundle, name), 'data');
      await assert.rejects(snapshotBundle(bundle), /Invalid bundle path|Reserved bundle filename/);
    });
  }
});

test('rejects case collisions when supported by the filesystem', async (t) => {
  const { bundle } = await fixture(t);
  await fs.writeFile(join(bundle, 'Case.txt'), 'one');
  await fs.writeFile(join(bundle, 'case.txt'), 'two');
  if ((await fs.stat(join(bundle, 'Case.txt'))).ino === (await fs.stat(join(bundle, 'case.txt'))).ino) return t.skip('Case-insensitive filesystem');
  await assert.rejects(snapshotBundle(bundle), /Case-colliding/);
});

test('rejects duplicate keys, invalid UTF-8, missing entries and unsupported hooks', async (t) => {
  const cases = [
    ['duplicate', `{"name":"duplicate",${JSON.stringify(manifest()).slice(1)}`, /Duplicate JSON key/],
    ['utf8', Buffer.from([0xff, 0xfe]), /valid UTF-8/],
    ['entry', JSON.stringify({ ...manifest(), provides: { views: { main: { title: 'Missing', entry: 'missing.html', placement: 'tab' } } } }), /Missing bundle entry/],
    ['hooks', JSON.stringify({ ...manifest(), install: 'npm install' }), /Unsupported field/],
  ];
  for (const [name, data, pattern] of cases) await t.test(name, async (t) => {
    const { bundle } = await fixture(t);
    await fs.writeFile(join(bundle, 'radius-app.json'), data);
    await assert.rejects(snapshotBundle(bundle), pattern);
  });
});

test('snapshotDirectoryFiles can copy a template without pretending it is an installed bundle', async (t) => {
  const { directory } = await fixture(t);
  const source = join(directory, 'template');
  await fs.mkdir(source);
  await fs.writeFile(join(source, 'README.md'), '# Template\n');
  assert.deepEqual(await snapshotDirectoryFiles(source), { 'README.md': Buffer.from('# Template\n').toString('base64') });
  await assert.rejects(snapshotBundle(source), /Missing radius-app.json/);
});

test('materialization preflights aliases, noncanonical bytes and accessors before any write', async (t) => {
  const { directory } = await fixture(t);
  const output = join(directory, 'output');
  await fs.mkdir(output);
  for (const files of [
    { 'Case.txt': '', 'case.txt': '' },
    { 'Case/a.txt': '', 'case/b.txt': '' },
    { file: '', 'file/child.txt': '' },
    { '../escape.txt': '' },
    { 'ok.txt': 'YQ' },
    { 'ok.txt': 'YQ==\n' },
    { 'ok.txt': 'YR==' },
    { 'ok.txt': 12 },
  ]) {
    assert.throws(() => validateDirectoryFiles(files));
    await assert.rejects(writeSnapshotFiles(output, files));
    assert.deepEqual(await fs.readdir(output), []);
  }
  let accessed = false;
  const getter = Object.defineProperty({}, 'bad.txt', { enumerable: true, get() { accessed = true; return ''; } });
  await assert.rejects(writeSnapshotFiles(output, getter), /Accessor/);
  assert.equal(accessed, false);
});

test('empty directory trees cannot bypass the global entry bound', async (t) => {
  const { bundle } = await fixture(t);
  for (const parent of ['a', 'b']) {
    await fs.mkdir(join(bundle, parent));
    await Promise.all(Array.from({ length: 260 }, (_, index) => fs.mkdir(join(bundle, parent, `d${index}`))));
  }
  await assert.rejects(snapshotBundle(bundle), /Too many bundle entries/);
});
