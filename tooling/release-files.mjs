// Bounded, no-follow I/O shared by the offline release tools. No app imports.
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash, createPrivateKey } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AppContractError, canonicalAppJson, parseAppJson } from '@radius/apps-sdk';
import { decodeAppText } from '@radius/apps-sdk/release';

export const LIMITS = Object.freeze({ json: 32 * 1024 * 1024, metadata: 256 * 1024, provenance: 16 * 1024, keys: 512 * 1024, releases: 64, revocations: 256, summaries: 2 * 1024 * 1024 });
export function check(ok, message) { if (!ok) throw new AppContractError('INVALID_ARGUMENT', message); }
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const jsonHash = value => sha256(canonicalAppJson(value));
export const inside = (parent, target) => { const p = relative(parent, target); return p === '' || (p !== '..' && !p.startsWith(`..${sep}`) && !isAbsolute(p)); };
export const sameFile = (a, b) => ['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(k => a[k] === b[k]);
export function exact(value, fields, label = 'object') {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(k => Object.hasOwn(value, k)), `Invalid ${label} fields`);
  return value;
}
export function text(value, pattern, label) { check(typeof value === 'string' && pattern.test(value), `Invalid ${label}`); return value; }
export const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export const DIGEST = /^[a-f0-9]{64}$/;
export const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export async function readBytes(file, maximum = LIMITS.json, inspect = () => {}) {
  check(constants.O_NOFOLLOW && constants.O_NONBLOCK, 'Safe no-follow file access is unavailable');
  const path = resolve(file);
  const before = await fs.lstat(path, { bigint: true });
  check(before.isFile() && before.nlink === 1n && before.size >= 0n && before.size <= BigInt(maximum), 'Input must be a bounded regular file without symlinks or hard links');
  inspect(before);
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const bytes = Buffer.alloc(Number(before.size) + 1);
  try {
    check(sameFile(before, await handle.stat({ bigint: true })), 'Input changed before reading');
    let count = 0;
    while (count < bytes.length) {
      const { bytesRead } = await handle.read(bytes, count, bytes.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    check(count === Number(before.size) && sameFile(before, await handle.stat({ bigint: true })) && sameFile(before, await fs.lstat(path, { bigint: true })), 'Input changed while reading');
    return Buffer.from(bytes.subarray(0, count));
  } finally { bytes.fill(0); await handle.close(); }
}
export const readJson = async (file, maximum) => parseAppJson(decodeAppText(await readBytes(file, maximum)));

// Fail closed even for mixed expressions such as "MIT OR UNLICENSED". This is
// an explicit decision gate, not a legal opinion or a complete SPDX validator.
export function assertLicense(value, label) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value) && !/(?:UNLICENSED|UNKNOWN|PENDING|TBD|TODO|NOASSERTION|SEE LICENSE)/i.test(value), `${label} license is unresolved; signing/publication is blocked`);
}

export async function outputPath(requested, repo) {
  const parent = await fs.realpath(dirname(resolve(requested)));
  const path = join(parent, basename(resolve(requested)));
  if (repo) check(!inside(repo, path), 'Release outputs must be outside the source checkout');
  try { await fs.lstat(path); check(false, 'Output already exists; refusing to overwrite'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return path;
}

export async function writeJsonExclusive(path, value, maximum = LIMITS.json) {
  const content = `${canonicalAppJson(value)}\n`;
  check(Buffer.byteLength(content) <= maximum, 'Output exceeds byte limit');
  const file = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
}

export async function writeDirectory(requested, entries, repo) {
  const path = await outputPath(requested, repo);
  await fs.mkdir(path, { mode: 0o700 }); // Exclusive; never replace even an empty directory.
  try {
    for (const [name, value] of Object.entries(entries)) {
      check(/^[a-z0-9][a-z0-9.-]*$/.test(name), 'Invalid output name');
      await writeJsonExclusive(join(path, name), value);
    }
  } catch (error) { await fs.rm(path, { recursive: true, force: true }); throw error; }
  return path;
}

export async function readPrivateKey(file, excluded) {
  let bytes;
  try {
    const path = await fs.realpath(resolve(file));
    check(excluded.every(dir => !inside(dir, path)), 'Private key must be outside source and artifact directories');
    bytes = await readBytes(file, 8192, stat => {
      check(stat.size > 0n && (stat.mode & 0o077n) === 0n && typeof process.geteuid === 'function' && stat.uid === BigInt(process.geteuid()), 'Private key must be an owner-private regular file');
    });
    const key = createPrivateKey({ key: bytes, format: 'pem' });
    check(key.type === 'private' && key.asymmetricKeyType === 'ed25519', 'Expected Ed25519 private key');
    return key;
  } catch { throw new AppContractError('INVALID_ARGUMENT', 'Private key could not be read safely (external owner-private Ed25519 PEM required)'); }
  finally { bytes?.fill(0); }
}
