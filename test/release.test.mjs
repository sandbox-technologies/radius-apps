import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalAppJson } from '@radius/apps-sdk';
import { appRevocationSigningMessage, verifyAppCatalogRelease } from '@radius/apps-sdk/release';
import { buildCatalog, prepareRelease, releaseCli, signRelease } from '../tooling/release.mjs';
import { catalogStateDigest, compareVersions, mergeCatalogState, parseTrustKeys, readCatalogState, sourceSigningMessage, verifySignedRelease } from '../tooling/release-catalog.mjs';
import { LIMITS, readBytes, sha256 } from '../tooling/release-files.mjs';

const exec = promisify(execFile);
const repository = 'https://example.test/radius/apps';
const publisher = 'fixture.publisher';
const keyId = 'fixture-key';
const fixtureLicense = 'LicenseRef-Disposable-Test-Fixture';
const emptyState = () => ({ operator: { schemaVersion: 1, releases: [], revocations: [] }, sources: { schemaVersion: 1, provenance: [] } });
const json = async path => JSON.parse(await fs.readFile(path, 'utf8'));
const writeJson = (path, value) => fs.writeFile(path, `${canonicalAppJson(value)}\n`);
const manifest = version => ({
  schemaVersion: 2, apiVersion: 'radius.apps/1', id: 'dev.test.release', name: 'Release test', version,
  worker: { entry: 'worker.js' }, instances: { mode: 'none', stateSchemaVersion: 1 },
  provides: { actions: { ping: { title: 'Ping', contexts: ['app'], requires: [], inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'object', properties: {}, additionalProperties: false }, implementation: { kind: 'handler', export: 'ping' } } }, views: {}, events: {}, triggers: {} },
});

// All keys and Git objects exist only inside private disposable test fixtures.
// Never commit the real checkout, import a fixture worker, or contact a remote.
async function fixture(t, { licenses = {}, sdkDirty = false, omitSdkDirty = false } = {}) {
  const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'radius-release-test-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo'); const work = join(base, 'work'); const keyDirectory = join(base, 'keys');
  for (const path of [repo, work, keyDirectory, join(repo, 'apps/test-app/bundle'), join(repo, 'vendor/apps-sdk')]) await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const git = async (...args) => (await exec('git', ['-C', repo, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Disposable fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'Disposable fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' } })).stdout.trim();
  await git('init', '--quiet'); await git('config', 'remote.origin.url', repository);
  await fs.writeFile(join(repo, '.gitignore'), '*.pem\n');
  await writeJson(join(repo, 'package.json'), { name: 'fixture', license: licenses.repository ?? fixtureLicense });
  await writeJson(join(repo, 'apps/test-app/app.json'), { schemaVersion: 1, slug: 'test-app', status: 'experimental', license: licenses.app ?? fixtureLicense });
  await writeJson(join(repo, 'apps/test-app/bundle/radius-app.json'), manifest('1.0.0'));
  await fs.writeFile(join(repo, 'apps/test-app/bundle/worker.js'), 'throw new Error("Release tools must never execute this worker");\n');
  const sdkPackage = `${canonicalAppJson({ name: '@radius/apps-sdk', version: '0.1.0-experimental.1', license: licenses.sdk ?? fixtureLicense })}\n`;
  const sdkIndex = '// Generated fixture data, never imported.\n';
  await fs.writeFile(join(repo, 'vendor/apps-sdk/package.json'), sdkPackage);
  await fs.writeFile(join(repo, 'vendor/apps-sdk/index.js'), sdkIndex);
  await writeJson(join(repo, 'vendor/apps-sdk/SOURCE.json'), {
    schemaVersion: 1, upstream: 'example/fixture', commit: 'a'.repeat(40), version: '0.1.0-experimental.1',
    ...(omitSdkDirty ? {} : { sourceTreeDirty: sdkDirty }), outputs: { 'package.json': sha256(sdkPackage), 'index.js': sha256(sdkIndex) },
  });
  const commit = async () => {
    await git('add', '--all');
    const tree = await git('write-tree');
    let parent;
    try { parent = await git('rev-parse', '--verify', 'HEAD'); } catch { /* first fixture commit */ }
    const hash = await git('commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'Disposable release test fixture');
    await git('update-ref', 'HEAD', hash);
    return hash;
  };
  const key = generateKeyPairSync('ed25519');
  const privateKey = join(keyDirectory, 'private.pem');
  await fs.writeFile(privateKey, key.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const keys = { [keyId]: { publisherId: publisher, publicKeyPem: key.publicKey.export({ type: 'spki', format: 'pem' }).toString() } };
  const trustedKeys = join(work, 'keys.json'); await writeJson(trustedKeys, keys);
  const options = { repo, app: 'test-app', repository, publisher, commit: await commit(), keyId, privateKey, trustedKeys };
  let sequence = 0;
  const issue = async () => {
    const prefix = `r${++sequence}`;
    const prepared = join(work, `${prefix}-prepared.json`); const out = join(work, `${prefix}-signed`);
    await prepareRelease({ ...options, out: prepared });
    await signRelease({ ...options, prepared, out });
    return { release: await json(join(out, 'release.json')), provenance: await json(join(out, 'provenance.json')), out, prepared };
  };
  const changeVersion = async version => {
    await writeJson(join(repo, 'apps/test-app/bundle/radius-app.json'), manifest(version));
    options.commit = await commit();
  };
  return { base, repo, work, keyDirectory, privateKey, keys, key, options, git, commit, issue, changeVersion };
}

test('real clean Git fixture prepares/signs without ever executing bundle code; host verifies immutable envelope', async t => {
  const f = await fixture(t); const signed = await f.issue();
  const verified = verifyAppCatalogRelease(signed.release, f.keys);
  assert.equal(verified.manifest.id, 'dev.test.release');
  assert.equal(signed.provenance.payload.commit, await f.git('rev-parse', 'HEAD'));
  assert.equal(signed.provenance.payload.repository, repository);
  assert.equal(signed.provenance.payload.releaseSha256, sha256(canonicalAppJson(signed.release)));
  assert.equal(signed.provenance.payload.sdkSourceTreeDirty, false);
  assert.deepEqual(Object.keys(signed.release).sort(), ['keyId', 'payload', 'schemaVersion', 'signature']);
  verifySignedRelease(signed.release, signed.provenance, f.keys, { repository, commit: f.options.commit });
  await assert.rejects(signRelease({ ...f.options, prepared: signed.prepared, out: signed.out }), /already exists/);
  assert.equal(await f.git('status', '--porcelain'), '');
});

for (const scope of ['repository', 'app', 'sdk']) {
  test(`prepare permits pending ${scope} license; signing fails before reading any private key`, async t => {
    const f = await fixture(t, { licenses: { [scope]: 'UNLICENSED' } });
    const out = join(f.work, 'prepared.json'); await prepareRelease({ ...f.options, out });
    await assert.rejects(signRelease({ ...f.options, prepared: out, privateKey: '/not/a/key', out: join(f.work, 'signed') }), /license is unresolved/);
    assert.equal((await json(out)).source.licenses[scope], 'UNLICENSED');
  });
}

for (const option of [{ sdkDirty: true }, { omitSdkDirty: true }]) {
  test(`SDK source cleanliness gate rejects ${JSON.stringify(option)} while unsigned preparation works`, async t => {
    const f = await fixture(t, option); const prepared = join(f.work, 'prepared.json');
    await prepareRelease({ ...f.options, out: prepared });
    await assert.rejects(signRelease({ ...f.options, prepared, out: join(f.work, 'signed') }), /sourceTreeDirty: false/);
  });
}

test('SDK output inventory and committed bytes must match SOURCE.json', async t => {
  const f = await fixture(t);
  await fs.writeFile(join(f.repo, 'vendor/apps-sdk/index.js'), '// changed in reviewed tree but hash not updated');
  f.options.commit = await f.commit();
  await assert.rejects(prepareRelease({ ...f.options, out: join(f.work, 'prepared') }), /SDK output does not match/);
});

test('requires full clean commit and exact repository; ignore-index bits cannot hide changed bundle bytes', async t => {
  const f = await fixture(t); const out = join(f.work, 'prepared');
  await assert.rejects(prepareRelease({ ...f.options, commit: 'HEAD', out }), /full reviewed commit/);
  await assert.rejects(prepareRelease({ ...f.options, commit: 'b'.repeat(40), out }), /HEAD does not equal/);
  await assert.rejects(prepareRelease({ ...f.options, repository: 'https://example.test/other/repo', out }), /Repository identity/);
  await fs.writeFile(join(f.repo, 'untracked.txt'), 'not reviewed');
  await assert.rejects(prepareRelease({ ...f.options, out }), /must be clean/);
  await fs.unlink(join(f.repo, 'untracked.txt'));
  await f.git('update-index', '--assume-unchanged', 'apps/test-app/bundle/worker.js');
  await fs.writeFile(join(f.repo, 'apps/test-app/bundle/worker.js'), '// bytes differ but status is clean\n');
  assert.equal(await f.git('status', '--porcelain'), '');
  await assert.rejects(prepareRelease({ ...f.options, out }), /Bundle bytes differ/);
});

test('prepared artifact modification is rejected against independently pinned Git source', async t => {
  const f = await fixture(t); const prepared = join(f.work, 'prepared.json');
  await prepareRelease({ ...f.options, out: prepared });
  const value = await json(prepared);
  value.source.licenses.app = 'LicenseRef-Tampered';
  await writeJson(prepared, value);
  await assert.rejects(signRelease({ ...f.options, prepared, out: join(f.work, 'signed') }), /differs from reviewed source/);
  value.payload.files['../escape.js'] = Buffer.from('// no').toString('base64');
  await writeJson(prepared, value);
  await assert.rejects(signRelease({ ...f.options, prepared, out: join(f.work, 'signed') }));
});

test('signer rejects untrusted keys, publisher mismatch, wrong private key and unsafe key files', async t => {
  const f = await fixture(t); const prepared = join(f.work, 'prepared.json');
  await prepareRelease({ ...f.options, out: prepared });
  const options = { ...f.options, prepared, out: join(f.work, 'signed') };
  const untrusted = join(f.work, 'untrusted.json'); await writeJson(untrusted, {});
  await assert.rejects(signRelease({ ...options, trustedKeys: untrusted }), /not trusted/);
  await writeJson(untrusted, { [keyId]: { ...f.keys[keyId], publisherId: 'other.publisher' } });
  await assert.rejects(signRelease({ ...options, trustedKeys: untrusted }), /not trusted/);
  const otherKey = generateKeyPairSync('ed25519'); const otherFile = join(f.keyDirectory, 'other.pem');
  await fs.writeFile(otherFile, otherKey.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  await assert.rejects(signRelease({ ...options, privateKey: otherFile }), /does not match/);
  await fs.chmod(f.privateKey, 0o644);
  await assert.rejects(signRelease(options), /could not be read safely/);
  await fs.chmod(f.privateKey, 0o600);
  const link = join(f.keyDirectory, 'symlink.pem'); await fs.symlink(f.privateKey, link);
  await assert.rejects(signRelease({ ...options, privateKey: link }), /could not be read safely/);
  const hard = join(f.keyDirectory, 'hard.pem'); await fs.link(f.privateKey, hard);
  await assert.rejects(signRelease(options), /could not be read safely/); await fs.unlink(hard);
  const inside = join(f.repo, 'ignored.pem'); await fs.copyFile(f.privateKey, inside); await fs.chmod(inside, 0o600);
  await assert.rejects(signRelease({ ...options, privateKey: inside }), /could not be read safely/);
});

test('independent release/source signature verification rejects tampering, key and version substitutions', async t => {
  const f = await fixture(t); const signed = await f.issue();
  const clone = value => JSON.parse(JSON.stringify(value));
  for (const mutate of [r => { r.payload.version = '9.0.0'; }, r => { r.payload.files['worker.js'] = Buffer.from('// modified').toString('base64'); }, r => { r.keyId = 'unknown'; }, r => { r.signature = Buffer.alloc(64).toString('base64'); }]) {
    const release = clone(signed.release); mutate(release);
    assert.throws(() => verifySignedRelease(release, signed.provenance, f.keys, { repository }));
  }
  for (const mutate of [p => { p.payload.commit = 'd'.repeat(40); }, p => { p.payload.repository = 'https://example.test/attacker/apps'; }, p => { p.payload.releaseSha256 = 'e'.repeat(64); }, p => { p.payload.licenses.app = 'MIT'; }, p => { p.keyId = 'unknown'; }]) {
    const provenance = clone(signed.provenance); mutate(provenance);
    assert.throws(() => verifySignedRelease(signed.release, provenance, f.keys, { repository }));
  }
  const wrongDomain = clone(signed.provenance);
  wrongDomain.signature = sign(null, Buffer.from(canonicalAppJson(wrongDomain.payload)), f.key.privateKey).toString('base64');
  assert.throws(() => verifySignedRelease(signed.release, wrongDomain, f.keys), /signature/);
  assert.throws(() => verifySignedRelease(signed.release, signed.provenance, f.keys, { commit: 'f'.repeat(40) }), /commit mismatch/);
});

test('actual two-commit catalog dry run preserves signed releases, provenance and revocations; pins baseline', async t => {
  const f = await fixture(t); const first = await f.issue();
  const seed = join(f.work, 'seed'); await fs.mkdir(seed);
  await writeJson(join(seed, 'operator.json'), emptyState().operator); await writeJson(join(seed, 'sources.json'), emptyState().sources);
  const firstOut = join(f.work, 'catalog1');
  const result1 = await buildCatalog({ ...f.options, release: first.out, previous: seed, previousSha256: catalogStateDigest(emptyState()), out: firstOut });
  const previous = await readCatalogState(firstOut);
  assert.equal(result1.releases, 1);
  const payload = { publisherId: publisher, appId: first.release.payload.appId, digest: first.release.payload.digest, revokedAt: '2026-11-16T00:00:00.000Z', reason: 'Disposable security test revocation' };
  const revocation = { schemaVersion: 1, keyId, payload, signature: sign(null, appRevocationSigningMessage(payload), f.key.privateKey).toString('base64') };
  const revocations = join(f.work, 'revocations.json'); await writeJson(revocations, [revocation]);
  await f.changeVersion('1.1.0'); const second = await f.issue();
  const out = join(f.work, 'catalog2');
  const options = { ...f.options, release: second.out, previous: firstOut, previousSha256: result1.stateSha256, revocations, out };
  await assert.rejects(buildCatalog({ ...options, previousSha256: '0'.repeat(64) }), /pinned baseline/);
  const result2 = await buildCatalog(options);
  assert.equal(result2.releases, 2); assert.equal(result2.revocations, 1);
  const next = await readCatalogState(out);
  assert.deepEqual(next.operator.releases[0], previous.operator.releases[0]);
  assert.deepEqual(next.sources.provenance[0], previous.sources.provenance[0]);
  assert.deepEqual(next.operator.revocations, [revocation]);
  assert.deepEqual(Object.keys(next.operator).sort(), ['releases', 'revocations', 'schemaVersion']);
  const repeat = mergeCatalogState(next, second, f.keys, { repository, commit: f.options.commit });
  assert.deepEqual(repeat, next);
  const routes = await json(join(out, 'routes.json'));
  assert.equal(routes.routes[`/api/radius-apps/releases/${first.release.payload.digest}`], `${first.release.payload.digest}.json`);
  assert.equal((await json(join(out, 'summaries.json'))).releases[1].releaseUrl, `/api/radius-apps/releases/${second.release.payload.digest}`);
  assert.equal((await json(join(out, 'state.json'))).sha256, catalogStateDigest(next));
  for (const release of next.operator.releases) verifyAppCatalogRelease(release, f.keys);
  assert.equal(await f.git('status', '--porcelain'), '');
});

test('catalog refuses changed version digests, source replacement, rollback, equal precedence and untrusted history', async t => {
  const f = await fixture(t); const first = await f.issue();
  const baseline = mergeCatalogState(emptyState(), first, f.keys, { repository });
  await fs.writeFile(join(f.repo, 'apps/test-app/bundle/worker.js'), '// changed same version\n');
  f.options.commit = await f.commit(); const changed = await f.issue();
  assert.throws(() => mergeCatalogState(baseline, changed, f.keys, { repository }), /Immutable version/);
  const provenance = JSON.parse(JSON.stringify(first.provenance)); provenance.payload.commit = f.options.commit;
  provenance.signature = sign(null, sourceSigningMessage(provenance.payload), f.key.privateKey).toString('base64');
  assert.throws(() => mergeCatalogState(baseline, { release: first.release, provenance }, f.keys, { repository }), /Immutable source/);
  await f.changeVersion('0.9.0'); const rollback = await f.issue();
  assert.throws(() => mergeCatalogState(baseline, rollback, f.keys, { repository }), /rollback/);
  await f.changeVersion('1.0.0+metadata'); const equal = await f.issue();
  assert.throws(() => mergeCatalogState(baseline, equal, f.keys, { repository }), /equal SemVer/);
  assert.throws(() => mergeCatalogState(baseline, first, {}, { repository }), /Untrusted/);
  const bad = JSON.parse(JSON.stringify(baseline)); bad.operator.releases[0].signature = Buffer.alloc(64).toString('base64');
  assert.throws(() => mergeCatalogState(bad, first, f.keys, { repository }), /signature/);
});

test('revocation append is authenticated, immutable and cannot reintroduce a revoked new release', async t => {
  const f = await fixture(t); const first = await f.issue();
  const payload = { publisherId: publisher, appId: first.release.payload.appId, digest: first.release.payload.digest, revokedAt: '2026-11-16T00:00:00.000Z', reason: 'Test only' };
  const revoked = { schemaVersion: 1, keyId, payload, signature: sign(null, appRevocationSigningMessage(payload), f.key.privateKey).toString('base64') };
  const baseline = mergeCatalogState(emptyState(), first, f.keys, { repository });
  const next = mergeCatalogState(baseline, { ...first, revocations: [revoked] }, f.keys, { repository });
  assert.deepEqual(mergeCatalogState(next, first, f.keys, { repository }).operator.revocations, [revoked]);
  const altered = { ...revoked, payload: { ...payload, reason: 'Replacement reason' } };
  altered.signature = sign(null, appRevocationSigningMessage(altered.payload), f.key.privateKey).toString('base64');
  assert.throws(() => mergeCatalogState(next, { ...first, revocations: [altered] }, f.keys, { repository }), /Immutable revocation/);
  assert.throws(() => mergeCatalogState(emptyState(), { ...first, revocations: [revoked] }, f.keys, { repository }), /already revoked/);
  const tampered = { ...revoked, signature: Buffer.alloc(64).toString('base64') };
  assert.throws(() => mergeCatalogState(baseline, { ...first, revocations: [tampered] }, f.keys, { repository }), /signature/);
});

test('bounded input reads and exclusive outputs reject oversized files and links', async t => {
  const f = await fixture(t); const large = join(f.work, 'large.json');
  const handle = await fs.open(large, 'wx'); await handle.truncate(LIMITS.json + 1); await handle.close();
  await assert.rejects(readBytes(large), /bounded regular file/);
  const target = join(f.work, 'existing'); await fs.writeFile(target, 'unchanged');
  const out = join(f.work, 'link'); await fs.symlink(target, out);
  await assert.rejects(prepareRelease({ ...f.options, out }), /already exists/);
  assert.equal(await fs.readFile(target, 'utf8'), 'unchanged');
  await assert.rejects(prepareRelease({ ...f.options, out: join(f.repo, 'artifact.json') }), /outside the source/);
  await assert.rejects(readBytes(out), /bounded regular file/);
});

test('strict CLI flags, key algorithm and SemVer precedence', async () => {
  await assert.rejects(releaseCli(['sign', '--repo', 'a', '--repo', 'b']), /Duplicate/);
  await assert.rejects(releaseCli(['sign', '--unknown', 'x']));
  await assert.rejects(releaseCli(['publish']));
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => parseTrustKeys({ test: { publisherId: publisher, publicKeyPem: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString() } }), /Ed25519/);
  for (const [a, b] of [['1.0.0', '1.0.0-rc.1'], ['1.0.0-beta.11', '1.0.0-beta.2'], ['1.0.0-beta', '1.0.0-2'], ['100000000000000000000.0.0', '99999999999999999999.0.0']]) assert.equal(compareVersions(a, b), 1);
  assert.equal(compareVersions('1.0.0+one', '1.0.0+two'), 0);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
});
