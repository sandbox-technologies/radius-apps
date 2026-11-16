import { createPublicKey, verify } from 'node:crypto';
import { join } from 'node:path';
import { canonicalAppJson, parseAppJson } from '@radius/apps-sdk';
import { decodeAppBase64, verifyAppCatalogRelease, verifyAppRevocation } from '@radius/apps-sdk/release';
import { check, DIGEST, exact, ID, jsonHash, LIMITS, readJson, text, writeDirectory } from './release-files.mjs';
import { assertPublicationLicenses, repositoryIdentity, validatePrepared } from './release-source.mjs';

export function parseTrustKeys(value) {
  const keys = parseAppJson(canonicalAppJson(value));
  check(keys && typeof keys === 'object' && !Array.isArray(keys) && Object.keys(keys).length <= 64 && Buffer.byteLength(canonicalAppJson(keys)) <= LIMITS.keys, 'Invalid trusted key map');
  for (const [id, entry] of Object.entries(keys)) {
    text(id, ID, 'trusted key ID'); exact(entry, ['publisherId', 'publicKeyPem'], 'trusted key'); text(entry.publisherId, ID, 'trusted publisher');
    check(typeof entry.publicKeyPem === 'string' && entry.publicKeyPem.length <= 8192 && entry.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----'), 'Expected public key PEM');
    let key;
    try { key = createPublicKey(entry.publicKeyPem); } catch { check(false, 'Invalid public key PEM'); }
    check(key.asymmetricKeyType === 'ed25519', 'Trusted key must be Ed25519');
  }
  return keys;
}
export const sourceSigningMessage = payload => Buffer.from(`radius.apps/source-provenance/1\n${canonicalAppJson(payload)}`, 'utf8');

export function verifySourceProvenance(value, release, keys, expected = {}) {
  check(Buffer.byteLength(canonicalAppJson(value)) <= LIMITS.provenance, 'Provenance exceeds byte limit');
  const envelope = exact(parseAppJson(canonicalAppJson(value)), ['schemaVersion', 'keyId', 'payload', 'signature'], 'source envelope');
  check(envelope.schemaVersion === 1 && envelope.keyId === release.keyId, 'Source/release signer mismatch');
  const { releaseSha256, ...source } = envelope.payload ?? {};
  text(releaseSha256, DIGEST, 'source release hash');
  const prepared = validatePrepared({ schemaVersion: 1, payload: release.payload, source });
  check(releaseSha256 === jsonHash(release), 'Provenance does not bind this exact signed release');
  if (expected.repository !== undefined) check(source.repository === repositoryIdentity(expected.repository), 'Provenance repository mismatch');
  if (expected.commit !== undefined) check(source.commit === expected.commit, 'Provenance reviewed commit mismatch');
  const key = Object.hasOwn(keys, envelope.keyId) ? keys[envelope.keyId] : null;
  check(key && key.publisherId === source.publisherId, 'Source signer is not trusted for publisher');
  let authenticated = false;
  try {
    const publicKey = createPublicKey(key.publicKeyPem);
    const signature = decodeAppBase64(envelope.signature, 64);
    authenticated = signature.length === 64 && publicKey.asymmetricKeyType === 'ed25519' && verify(null, sourceSigningMessage(envelope.payload), publicKey, signature);
  } catch { /* Fail with a stable error, not native cryptographic diagnostics. */ }
  check(authenticated, 'Invalid source provenance signature');
  assertPublicationLicenses(source);
  return prepared;
}

export function verifySignedRelease(release, provenance, keys, expected = {}) {
  const bundle = verifyAppCatalogRelease(release, keys);
  const prepared = verifySourceProvenance(provenance, release, keys, expected);
  return { bundle, prepared };
}

export const catalogStateDigest = state => jsonHash(state);
export async function readCatalogState(directory) {
  return { operator: await readJson(join(directory, 'operator.json')), sources: await readJson(join(directory, 'sources.json')) };
}
export function validateCatalogState(value, keys, repository) {
  const state = exact(value, ['operator', 'sources'], 'catalog state');
  const operator = exact(state.operator, ['schemaVersion', 'releases', 'revocations'], 'operator catalog');
  const sources = exact(state.sources, ['schemaVersion', 'provenance'], 'catalog sources');
  check(operator.schemaVersion === 1 && sources.schemaVersion === 1 && Array.isArray(operator.releases) && operator.releases.length <= LIMITS.releases && Array.isArray(operator.revocations) && operator.revocations.length <= LIMITS.revocations && Array.isArray(sources.provenance) && sources.provenance.length === operator.releases.length, 'Invalid catalog sizes/schema');
  check(Buffer.byteLength(`${canonicalAppJson(operator)}\n`) <= LIMITS.json && Buffer.byteLength(canonicalAppJson({ schemaVersion: 1, revocations: operator.revocations })) <= LIMITS.summaries, 'Catalog exceeds host size limit');
  const sourceByDigest = new Map();
  for (const provenance of sources.provenance) {
    const digest = provenance?.payload?.digest;
    text(digest, DIGEST, 'provenance digest'); check(!sourceByDigest.has(digest), 'Duplicate source digest'); sourceByDigest.set(digest, provenance);
  }
  const identities = new Set(); const digests = new Set();
  for (const release of operator.releases) {
    const p = release.payload;
    verifySignedRelease(release, sourceByDigest.get(p?.digest), keys, { repository });
    const identity = `${p.publisherId}/${p.appId}/${p.version}`;
    check(!identities.has(identity) && !digests.has(p.digest), 'Duplicate release identity or digest');
    identities.add(identity); digests.add(p.digest);
  }
  const revocations = new Set();
  for (const revocation of operator.revocations) {
    const p = verifyAppRevocation(revocation, keys);
    const id = `${p.publisherId}/${p.appId}/${p.digest}`;
    check(!revocations.has(id), 'Duplicate revocation identity'); revocations.add(id);
  }
  return state;
}

// SemVer precedence without dependencies or unsafe Number coercion. Build
// metadata does not establish a newer version, even if its text differs.
export function compareVersions(a, b) {
  const parts = version => { const [core, pre] = version.split('+')[0].split(/-(.*)/s); return [core.split('.').map(BigInt), pre?.split('.')]; };
  const [ac, ap] = parts(a); const [bc, bp] = parts(b);
  for (let i = 0; i < 3; i++) if (ac[i] !== bc[i]) return ac[i] > bc[i] ? 1 : -1;
  if (!ap || !bp) return ap ? -1 : bp ? 1 : 0;
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === undefined) return -1; if (bp[i] === undefined) return 1;
    if (ap[i] === bp[i]) continue;
    const an = /^\d+$/.test(ap[i]); const bn = /^\d+$/.test(bp[i]);
    if (an && bn) return BigInt(ap[i]) > BigInt(bp[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return ap[i] > bp[i] ? 1 : -1;
  }
  return 0;
}

export function mergeCatalogState(previous, { release, provenance, revocations = [] }, keys, expected) {
  validateCatalogState(previous, keys, expected.repository);
  verifySignedRelease(release, provenance, keys, expected);
  check(Array.isArray(revocations) && revocations.length <= LIMITS.revocations, 'Invalid incoming revocations');
  const next = parseAppJson(canonicalAppJson(previous));
  const p = release.payload;
  const existing = next.operator.releases.find(r => r.payload.publisherId === p.publisherId && r.payload.appId === p.appId && r.payload.version === p.version);
  if (existing) {
    check(canonicalAppJson(existing) === canonicalAppJson(release), 'Immutable version mapping/envelope would change');
    const oldSource = next.sources.provenance.find(s => s.payload.digest === p.digest);
    check(canonicalAppJson(oldSource) === canonicalAppJson(provenance), 'Immutable source provenance would change');
  } else {
    for (const old of next.operator.releases) {
      check(old.payload.digest !== p.digest, 'Digest already belongs to an immutable release');
      if (old.payload.publisherId === p.publisherId && old.payload.appId === p.appId) check(compareVersions(p.version, old.payload.version) > 0, 'Release version rollback or equal SemVer precedence is forbidden');
    }
    next.operator.releases.push(release); next.sources.provenance.push(provenance);
  }
  for (const revocation of revocations) {
    const r = verifyAppRevocation(revocation, keys);
    const prior = next.operator.revocations.find(v => v.payload.publisherId === r.publisherId && v.payload.appId === r.appId && v.payload.digest === r.digest);
    if (prior) check(canonicalAppJson(prior) === canonicalAppJson(revocation), 'Immutable revocation would change');
    else next.operator.revocations.push(revocation);
  }
  if (!existing) check(!next.operator.revocations.some(r => r.payload.publisherId === p.publisherId && r.payload.appId === p.appId && r.payload.digest === p.digest), 'Cannot add a release that is already revoked');
  // No sort, pruning, replacement or "latest only" projection: all original
  // envelopes and revocations survive byte-for-byte canonical serialization.
  return validateCatalogState(next, keys, expected.repository);
}

export async function writeCatalog(directory, state, keys, repository, repo) {
  validateCatalogState(state, keys, repository);
  const summaries = { schemaVersion: 1, releases: state.operator.releases.map(release => {
    const bundle = verifyAppCatalogRelease(release, keys);
    const { appId, version, apiVersion, publisherId, digest } = release.payload;
    return { appId, version, apiVersion, publisherId, digest, manifest: bundle.manifest, releaseUrl: `/api/radius-apps/releases/${digest}` };
  }) };
  check(Buffer.byteLength(`${canonicalAppJson(summaries)}\n`) <= LIMITS.summaries, 'Catalog summaries exceed host byte limit');
  const routes = { '/api/radius-apps': 'summaries.json', '/api/radius-apps/revocations': 'revocations.json' };
  const entries = { 'operator.json': state.operator, 'sources.json': state.sources, 'summaries.json': summaries, 'revocations.json': { schemaVersion: 1, revocations: state.operator.revocations } };
  for (const release of state.operator.releases) {
    const name = `${release.payload.digest}.json`;
    entries[name] = release; routes[`/api/radius-apps/releases/${release.payload.digest}`] = name;
  }
  entries['routes.json'] = { schemaVersion: 1, contentType: 'application/json', redirects: false, routes };
  entries['state.json'] = { schemaVersion: 1, sha256: catalogStateDigest(state) };
  const out = await writeDirectory(directory, entries, repo);
  return { out, stateSha256: catalogStateDigest(state), releases: state.operator.releases.length, revocations: state.operator.revocations.length };
}
