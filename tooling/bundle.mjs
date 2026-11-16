import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { APP_LIMITS, AppContractError, canonicalAppJson, parseAppJson, validateAppBundlePath } from '@radius/apps-sdk';
import { decodeAppBase64, validateAppBundleFiles } from '@radius/apps-sdk/release';

const fail = (message, code = 'INVALID_ARGUMENT') => { throw new AppContractError(code, message); };
const check = (condition, message) => { if (!condition) fail(message); };
const stamp = (s) => [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs].join(':');
const same = (a, b) => stamp(a) === stamp(b);
const regular = (s) => check(s.isFile() && s.nlink === 1n, 'Expected a regular file without hard links');

function requireNoFollow() {
  if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY || !constants.O_NONBLOCK) {
    fail('This platform lacks required no-follow/nonblocking filesystem support', 'CAPABILITY_UNAVAILABLE');
  }
}

/** Bounded descriptor reads, not readFile(path): refuse links and special files,
 * including a FIFO substituted between lstat and open. Compare inode/ctime as
 * well as size and mtime, both on the held descriptor and at the pathname. */
export async function readBoundedFile(path, maximum) {
  requireNoFollow();
  check(Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= APP_LIMITS.bundleBytes, 'Invalid file byte limit');
  const before = await fs.lstat(path, { bigint: true });
  regular(before);
  if (before.size > BigInt(maximum)) fail('File exceeds byte limit', 'LIMIT_EXCEEDED');
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    regular(opened);
    check(same(before, opened), 'File changed while opening');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    check(length === Number(before.size), 'File changed while reading');
    const after = await handle.stat({ bigint: true });
    regular(after);
    check(same(before, after) && same(before, await fs.lstat(path, { bigint: true })), 'File changed during snapshot');
    return { bytes: bytes.subarray(0, length), metadata: stamp(before) };
  } finally {
    await handle.close();
  }
}

/** Resolve ancestor aliases (e.g. macOS /tmp) once, but never accept a symlink
 * for the requested directory itself. Callers must not trust writable ancestors
 * against a hostile process running as their own OS user. */
export async function realDirectory(path) {
  requireNoFollow();
  const requested = resolve(path);
  const before = await fs.lstat(requested, { bigint: true });
  check(before.isDirectory() && !before.isSymbolicLink(), 'Expected a real directory, not a symlink');
  const directory = await fs.realpath(requested);
  check(same(before, await fs.lstat(directory, { bigint: true })), 'Directory changed while resolving');
  return directory;
}

export async function directoryNames(path, maximum = APP_LIMITS.bundleFiles * 2) {
  const directory = await fs.opendir(path, { bufferSize: 32 });
  const names = [];
  try {
    for (;;) {
      const entry = await directory.read();
      if (!entry) return names.sort();
      if (names.length >= maximum) fail('Too many directory entries', 'LIMIT_EXCEEDED');
      names.push(entry.name);
    }
  } finally {
    await directory.close();
  }
}

async function scan(root) {
  const files = {};
  const metadata = {};
  const folded = new Set();
  let entries = 0;
  let fileCount = 0;
  let expanded = 0;
  const walk = async (directory, prefix) => {
    const before = await fs.lstat(directory, { bigint: true });
    check(before.isDirectory() && !before.isSymbolicLink(), 'Expected a real bundle directory');
    const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      check(same(before, await handle.stat({ bigint: true })), 'Directory changed while opening');
      for (const name of await directoryNames(directory)) {
        const local = prefix ? `${prefix}/${name}` : name;
        validateAppBundlePath(local);
        if (++entries > APP_LIMITS.bundleFiles * 2) fail('Too many bundle entries', 'LIMIT_EXCEEDED');
        check(!folded.has(local.toLowerCase()), 'Case-colliding bundle paths');
        folded.add(local.toLowerCase());
        const full = join(directory, name);
        const info = await fs.lstat(full, { bigint: true });
        if (info.isDirectory()) {
          await walk(full, local);
        } else {
          regular(info);
          if (++fileCount > APP_LIMITS.bundleFiles) fail('Too many bundle files', 'LIMIT_EXCEEDED');
          // Limit the aggregate before allocating/reading the next file.
          if (info.size + BigInt(expanded) > BigInt(APP_LIMITS.bundleBytes)) fail('Bundle exceeds expanded byte limit', 'LIMIT_EXCEEDED');
          const read = await readBoundedFile(full, APP_LIMITS.bundleFileBytes);
          check(read.metadata === stamp(info), 'Entry changed before reading');
          expanded += read.bytes.length;
          if (expanded > APP_LIMITS.bundleBytes) fail('Bundle exceeds expanded byte limit', 'LIMIT_EXCEEDED');
          files[local] = read.bytes.toString('base64');
          metadata[local] = read.metadata;
        }
      }
      check(same(before, await handle.stat({ bigint: true })) && same(before, await fs.lstat(directory, { bigint: true })), 'Directory changed during snapshot');
      metadata[prefix ? `${prefix}/` : '/'] = stamp(before);
    } finally {
      await handle.close();
    }
  };
  await walk(root, '');
  return { files, metadata };
}

/** A bounded, two-pass data snapshot; also used to copy contributor templates.
 * No app code, import, package manager, lifecycle hook, or native host runs here.
 * This detects filesystem races; it is not an OS sandbox for hostile users. */
export async function snapshotDirectoryFiles(directory) {
  const requested = resolve(directory);
  const root = await realDirectory(requested);
  const before = await fs.lstat(requested, { bigint: true });
  const first = await scan(root);
  const second = await scan(root);
  check(canonicalAppJson(first.metadata) === canonicalAppJson(second.metadata) && canonicalAppJson(first.files) === canonicalAppJson(second.files), 'Directory changed between snapshot passes');
  check(same(before, await fs.lstat(requested, { bigint: true })) && same(before, await fs.lstat(root, { bigint: true })), 'Snapshot root changed');
  return first.files;
}

function freezeData(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

/** Host-compatible canonical base64 map and SHA-256 digest. The SDK validates
 * raw manifest bytes and entries and owns the digest algorithm; metadata,
 * README, tests and filesystem attributes are not part of the app release. */
export async function snapshotBundle(directory) {
  return freezeData(validateAppBundleFiles(await snapshotDirectoryFiles(directory)));
}

/** The same portable path/byte bounds without requiring a manifest at the root
 * (a template also contains contributor metadata). Validate generated additions
 * before the caller creates any destination, including file/directory aliases. */
export function validateDirectoryFiles(value) {
  const files = parseAppJson(canonicalAppJson(value));
  check(files !== null && typeof files === 'object' && !Array.isArray(files), 'Expected a snapshot file map');
  const names = Object.keys(files);
  check(names.length <= APP_LIMITS.bundleFiles, 'Too many snapshot files');
  const paths = new Map();
  const directories = new Set();
  let expanded = 0;
  for (const name of names) {
    validateAppBundlePath(name);
    const segments = name.split('/');
    for (let index = 1; index <= segments.length; index++) {
      const path = segments.slice(0, index).join('/');
      const folded = path.toLowerCase();
      check(!paths.has(folded) || paths.get(folded) === path, 'Case-colliding snapshot paths');
      paths.set(folded, path);
      if (index < segments.length) directories.add(path);
    }
    expanded += decodeAppBase64(files[name], APP_LIMITS.bundleFileBytes).length;
    if (expanded > APP_LIMITS.bundleBytes) fail('Snapshot exceeds expanded byte limit', 'LIMIT_EXCEEDED');
  }
  for (const name of names) check(!directories.has(name), 'Snapshot file/directory path collision');
  return files;
}

/** Materialize only previously snapshotted bytes into a NEW, private directory.
 * Never recursively copy a source path after validating it. All path validation
 * occurs before writing; the destination must exist and be empty. */
export async function writeSnapshotFiles(directory, files, { readonly = false } = {}) {
  files = validateDirectoryFiles(files);
  const names = Object.keys(files).sort();
  const root = await realDirectory(directory);
  check((await directoryNames(root)).length === 0, 'Snapshot destination must be empty');
  const directories = new Set(['']);
  for (const name of names) {
    const segments = name.split('/');
    for (let i = 1; i < segments.length; i++) {
      const local = segments.slice(0, i).join('/');
      if (!directories.has(local)) {
        await fs.mkdir(join(root, local), { mode: 0o700 });
        directories.add(local);
      }
    }
    const handle = await fs.open(join(root, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(Buffer.from(files[name], 'base64'));
      if (readonly) await handle.chmod(0o444);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  for (const local of [...directories].sort((a, b) => b.length - a.length)) {
    const handle = await fs.open(join(root, local), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (readonly) await handle.chmod(0o555);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

/** Only for private staging/backup trees created by this process. Do not follow
 * links while making our read-only build directories removable. */
export async function removeOwnedTree(directory) {
  const info = await fs.lstat(directory).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  if (!info) return;
  if (info.isDirectory() && !info.isSymbolicLink()) {
    await fs.chmod(directory, 0o700);
    for (const name of await directoryNames(directory)) await removeOwnedTree(join(directory, name));
    await fs.rmdir(directory);
  } else {
    await fs.unlink(directory);
  }
}
