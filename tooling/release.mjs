#!/usr/bin/env node
// Offline data-only release pipeline. Never import a bundle, run its worker,
// spawn package scripts, install dependencies, fetch code or call a provider.
import { sign, createPublicKey } from 'node:crypto';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AppContractError, canonicalAppJson } from '@radius/apps-sdk';
import { assertPublicationLicenses, inspectSource, matchPrepared, repositoryIdentity, validatePrepared } from './release-source.mjs';
import { catalogStateDigest, mergeCatalogState, parseTrustKeys, readCatalogState, sourceSigningMessage, verifySignedRelease, writeCatalog } from './release-catalog.mjs';
import { check, COMMIT, DIGEST, ID, jsonHash, LIMITS, outputPath, readJson, readPrivateKey, text, writeDirectory, writeJsonExclusive } from './release-files.mjs';

export async function prepareRelease(options) {
  const { repo, prepared } = await inspectSource(options);
  validatePrepared(prepared);
  const out = await outputPath(options.out, repo);
  await writeJsonExclusive(out, prepared);
  return { out, digest: prepared.payload.digest, commit: prepared.source.commit, signed: false };
}

export async function signRelease(options) {
  const prepared = validatePrepared(await readJson(options.prepared));
  text(options.commit, COMMIT, 'full reviewed commit'); text(options.keyId, ID, 'key ID');
  assertPublicationLicenses(prepared.source); // Must happen before opening the key.
  const repo = await matchPrepared(prepared, options);
  const keys = parseTrustKeys(await readJson(options.trustedKeys, LIMITS.keys));
  const trusted = Object.hasOwn(keys, options.keyId) ? keys[options.keyId] : null;
  check(trusted && trusted.publisherId === prepared.payload.publisherId, 'Explicit public key is not trusted for this publisher');
  const out = await outputPath(options.out, repo);
  const preparedDirectory = await fs.realpath(dirname(resolve(options.prepared)));
  const key = await readPrivateKey(options.privateKey, [repo, out, preparedDirectory]);
  check(createPublicKey(key).export({ type: 'spki', format: 'der' }).equals(createPublicKey(trusted.publicKeyPem).export({ type: 'spki', format: 'der' })), 'Private key does not match the independently trusted public key');
  const release = { schemaVersion: 1, keyId: options.keyId, payload: prepared.payload, signature: sign(null, Buffer.from(canonicalAppJson(prepared.payload), 'utf8'), key).toString('base64') };
  const payload = { ...prepared.source, releaseSha256: jsonHash(release) };
  const provenance = { schemaVersion: 1, keyId: options.keyId, payload, signature: sign(null, sourceSigningMessage(payload), key).toString('base64') };
  verifySignedRelease(release, provenance, keys, { repository: options.repository, commit: options.commit });
  await writeDirectory(out, { 'release.json': release, 'provenance.json': provenance }, repo);
  return { out, digest: release.payload.digest, commit: payload.commit, signed: true };
}

export async function buildCatalog(options) {
  text(options.previousSha256, DIGEST, 'pinned previous catalog state digest');
  const keys = parseTrustKeys(await readJson(options.trustedKeys, LIMITS.keys));
  const previous = await readCatalogState(options.previous);
  check(catalogStateDigest(previous) === options.previousSha256, 'Previous catalog differs from the pinned baseline; refusing stale/rollback input');
  const release = await readJson(join(options.release, 'release.json'));
  const provenance = await readJson(join(options.release, 'provenance.json'), LIMITS.provenance);
  const expected = { repository: repositoryIdentity(options.repository), commit: text(options.commit, COMMIT, 'full reviewed commit') };
  const { prepared } = verifySignedRelease(release, provenance, keys, expected);
  const repo = await matchPrepared(prepared, options); // Also rechecks current licensing/metadata.
  const revocations = options.revocations ? await readJson(options.revocations, LIMITS.summaries) : [];
  const next = mergeCatalogState(previous, { release, provenance, revocations }, keys, expected);
  return writeCatalog(options.out, next, keys, expected.repository, repo);
}

const commands = {
  prepare: { required: ['repo', 'app', 'repository', 'commit', 'publisher', 'out'], optional: [], run: prepareRelease },
  sign: { required: ['repo', 'prepared', 'repository', 'commit', 'key-id', 'private-key', 'trusted-keys', 'out'], optional: [], run: signRelease },
  catalog: { required: ['repo', 'release', 'repository', 'commit', 'trusted-keys', 'previous', 'previous-sha256', 'out'], optional: ['revocations'], run: buildCatalog },
};
export async function releaseCli(args) {
  const [command, ...rest] = args;
  check(Object.hasOwn(commands, command), 'Expected prepare, sign or catalog');
  const spec = commands[command]; const names = [...spec.required, ...spec.optional];
  const { values, tokens } = parseArgs({ args: rest, strict: true, allowPositionals: false, tokens: true, options: Object.fromEntries(names.map(k => [k, { type: 'string' }])) });
  const seen = new Set();
  for (const token of tokens) { check(token.kind === 'option' && !seen.has(token.name), 'Duplicate/invalid command option'); seen.add(token.name); }
  for (const name of spec.required) check(typeof values[name] === 'string' && values[name].trim() && !values[name].includes('\0'), `Missing required --${name}`);
  const options = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
  return spec.run(options);
}

function direct() { try { return process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }
if (direct()) {
  try { console.log(canonicalAppJson(await releaseCli(process.argv.slice(2)))); }
  catch (error) {
    // Never print native error stacks, argument values, key paths/PEM or causes.
    console.error(`[release] ${error instanceof AppContractError ? error.message : 'Release operation failed safely; check inputs, permissions and required flags'}`);
    process.exitCode = 1;
  }
}
