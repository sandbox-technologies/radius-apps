import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { APP_LIMITS, canonicalAppJson, parseAppJson } from '@radius/apps-sdk';
import { decodeAppText, validateAppBundleFiles } from '@radius/apps-sdk/release';
import { snapshotBundle, snapshotDirectoryFiles } from './bundle.mjs';
import { assertLicense, check, COMMIT, exact, ID, jsonHash, LIMITS, readBytes, sha256, SLUG, text } from './release-files.mjs';

const run = promisify(execFile);
export function repositoryIdentity(value) {
  check(typeof value === 'string' && value.length <= 512, 'Expected canonical HTTPS repository identity');
  let url;
  try { url = new URL(value); } catch { check(false, 'Expected canonical HTTPS repository identity'); }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port && /^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?$/.test(url.pathname), 'Expected credential-free HTTPS repository identity');
  return `${url.origin}${url.pathname.replace(/\/$/, '').replace(/\.git$/, '')}`;
}
async function git(repo, args, maximum = 512 * 1024) {
  // Git is only a local object reader. Disable replacement objects, fsmonitor,
  // hooks, inherited command/config injection and optional index refresh writes.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' });
  try {
    const result = await run('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.untrackedCache=false', '-C', repo, ...args], { env, encoding: 'buffer', timeout: 30_000, maxBuffer: maximum });
    return result.stdout;
  } catch { check(false, 'Local Git inspection failed (missing commit, oversized input or invalid checkout); nothing was fetched'); }
}
async function clean(repo, commit, repository) {
  check(decodeAppText(await git(repo, ['rev-parse', '--show-toplevel'])).trim() === repo, 'Select the repository root');
  check(decodeAppText(await git(repo, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim() === commit, 'HEAD does not equal the explicit reviewed commit');
  check(repositoryIdentity(decodeAppText(await git(repo, ['config', '--get', 'remote.origin.url'])).trim()) === repository, 'Repository identity does not match the configured HTTPS origin');
  check((await git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'])).length === 0, 'Source checkout must be clean, including untracked files');
}
async function tree(repo, commit, path) {
  const records = decodeAppText(await git(repo, ['ls-tree', '-r', '-z', commit, '--', path]));
  return records.split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)$/.exec(record);
    check(match, 'Source includes a symlink, submodule or unsupported Git object');
    return { hash: match[2], path: match[3] };
  });
}
async function committedFile(repo, commit, path, maximum) {
  const records = await tree(repo, commit, path);
  check(records.length === 1 && records[0].path === path, 'Required release metadata is not a tracked regular file');
  const committed = await git(repo, ['cat-file', 'blob', records[0].hash], maximum + 1);
  check(committed.length <= maximum && committed.equals(await readBytes(join(repo, path), maximum)), 'Working metadata differs from exact committed bytes');
  return { bytes: committed, value: parseAppJson(decodeAppText(committed)) };
}

export async function inspectSource({ repo: requestedRepo, app, repository: requestedIdentity, commit, publisher }) {
  text(app, SLUG, 'app slug'); check(app.length <= 80, 'App slug is too long');
  text(commit, COMMIT, 'full reviewed commit'); text(publisher, ID, 'publisher');
  const repository = repositoryIdentity(requestedIdentity);
  const repo = await fs.realpath(resolve(requestedRepo));
  await clean(repo, commit, repository);
  const appPath = `apps/${app}`;
  const bundlePath = `${appPath}/bundle`;
  const snapshot = await snapshotBundle(join(repo, bundlePath));
  const committed = await tree(repo, commit, bundlePath);
  check(committed.length === Object.keys(snapshot.files).length && committed.length <= APP_LIMITS.bundleFiles, 'Bundle snapshot differs from committed file set');
  for (const entry of committed) {
    check(entry.path.startsWith(`${bundlePath}/`), 'Invalid committed bundle path');
    const path = entry.path.slice(bundlePath.length + 1);
    const bytes = await git(repo, ['cat-file', 'blob', entry.hash], APP_LIMITS.bundleFileBytes + 1);
    check(bytes.length <= APP_LIMITS.bundleFileBytes && snapshot.files[path] === bytes.toString('base64'), 'Bundle bytes differ from exact source commit');
  }
  const metadata = await committedFile(repo, commit, `${appPath}/app.json`, LIMITS.metadata);
  const root = await committedFile(repo, commit, 'package.json', LIMITS.metadata);
  const sdk = await committedFile(repo, commit, 'vendor/apps-sdk/package.json', LIMITS.metadata);
  const sdkSource = await committedFile(repo, commit, 'vendor/apps-sdk/SOURCE.json', LIMITS.metadata);
  const sdkFiles = await snapshotDirectoryFiles(join(repo, 'vendor/apps-sdk'));
  const outputs = sdkSource.value.outputs;
  check(outputs && typeof outputs === 'object' && !Array.isArray(outputs) && sdkSource.value.schemaVersion === 1 && sdkSource.value.version === sdk.value.version, 'Invalid SDK SOURCE output manifest');
  check(Object.keys(sdkFiles).length === Object.keys(outputs).length + 1 && !Object.hasOwn(outputs, 'SOURCE.json'), 'SDK output file set differs from SOURCE.json');
  for (const [path, hash] of Object.entries(outputs)) {
    text(hash, /^[a-f0-9]{64}$/, 'SDK output hash');
    check(Object.hasOwn(sdkFiles, path) && sha256(Buffer.from(sdkFiles[path], 'base64')) === hash, 'SDK output does not match SOURCE.json');
  }
  const sdkTree = await tree(repo, commit, 'vendor/apps-sdk');
  check(sdkTree.length === Object.keys(sdkFiles).length, 'SDK output differs from committed file set');
  for (const entry of sdkTree) {
    check(entry.path.startsWith('vendor/apps-sdk/'), 'Invalid SDK source path');
    check((await git(repo, ['cat-file', 'blob', entry.hash], APP_LIMITS.bundleFileBytes + 1)).toString('base64') === sdkFiles[entry.path.slice('vendor/apps-sdk/'.length)], 'SDK bytes differ from exact source commit');
  }
  check(metadata.value && typeof metadata.value === 'object' && !Array.isArray(metadata.value), 'Expected app metadata');
  // Licenses may be unresolved while preparing an unsigned artifact.
  const licenses = { repository: root.value.license ?? null, app: metadata.value.license ?? null, sdk: sdk.value.license ?? null };
  const payload = { appId: snapshot.manifest.id, version: snapshot.manifest.version, apiVersion: snapshot.manifest.apiVersion, publisherId: publisher, digest: snapshot.digest, files: snapshot.files };
  const source = {
    schemaVersion: 1, repository, commit, workingTree: 'clean', appPath, bundlePath,
    appId: payload.appId, version: payload.version, apiVersion: payload.apiVersion, publisherId: publisher, digest: payload.digest,
    appMetadataSha256: jsonHash(metadata.value), sdkSourceSha256: jsonHash(sdkSource.value), sdkVersion: sdk.value.version, sdkSourceTreeDirty: sdkSource.value.sourceTreeDirty ?? null, licenses,
  };
  await clean(repo, commit, repository);
  return { repo, prepared: { schemaVersion: 1, payload, source } };
}

export function validatePrepared(value) {
  const prepared = exact(value, ['schemaVersion', 'payload', 'source'], 'prepared release');
  check(prepared.schemaVersion === 1, 'Unsupported prepared release');
  const p = exact(prepared.payload, ['appId', 'version', 'apiVersion', 'publisherId', 'digest', 'files'], 'prepared payload');
  const bundle = validateAppBundleFiles(p.files);
  check(bundle.digest === p.digest && bundle.manifest.id === p.appId && bundle.manifest.version === p.version && bundle.manifest.apiVersion === p.apiVersion, 'Prepared release identity mismatch');
  text(p.publisherId, ID, 'publisher');
  const s = exact(prepared.source, ['schemaVersion', 'repository', 'commit', 'workingTree', 'appPath', 'bundlePath', 'appId', 'version', 'apiVersion', 'publisherId', 'digest', 'appMetadataSha256', 'sdkSourceSha256', 'sdkVersion', 'sdkSourceTreeDirty', 'licenses'], 'source provenance');
  check(s.schemaVersion === 1 && s.workingTree === 'clean' && repositoryIdentity(s.repository) === s.repository, 'Invalid source identity');
  text(s.commit, COMMIT, 'source commit');
  check(typeof s.appPath === 'string' && s.appPath.startsWith('apps/') && SLUG.test(s.appPath.slice(5)) && s.appPath.length <= 85 && s.bundlePath === `${s.appPath}/bundle`, 'Invalid source path');
  for (const field of ['appId', 'version', 'apiVersion', 'publisherId', 'digest']) check(s[field] === p[field], 'Source provenance does not match release');
  for (const field of ['appMetadataSha256', 'sdkSourceSha256']) text(s[field], /^[a-f0-9]{64}$/, field);
  check(typeof s.sdkVersion === 'string' && s.sdkVersion.length > 0 && s.sdkVersion.length <= 128, 'Invalid SDK version');
  check(s.sdkSourceTreeDirty === null || typeof s.sdkSourceTreeDirty === 'boolean', 'Invalid SDK source cleanliness marker');
  exact(s.licenses, ['repository', 'app', 'sdk'], 'source licenses');
  check(Buffer.byteLength(canonicalAppJson(s)) <= LIMITS.provenance, 'Source provenance exceeds limit');
  return prepared;
}
export function assertPublicationLicenses(source) {
  for (const [name, license] of Object.entries(source.licenses)) assertLicense(license, name);
  check(source.sdkSourceTreeDirty === false, 'SDK SOURCE.json must explicitly record sourceTreeDirty: false before signing/publication');
}
export async function matchPrepared(prepared, options) {
  validatePrepared(prepared);
  check(prepared.source.repository === repositoryIdentity(options.repository) && prepared.source.commit === options.commit, 'Prepared source differs from reviewed repository/commit');
  const inspected = await inspectSource({ ...options, app: prepared.source.appPath.slice(5), publisher: prepared.payload.publisherId });
  check(canonicalAppJson(inspected.prepared) === canonicalAppJson(prepared), 'Prepared artifact differs from reviewed source snapshot');
  return inspected.repo;
}
