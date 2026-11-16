#!/usr/bin/env node
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_MANIFEST_LIMITS, AppContractError, canonicalAppJson, parseAppJson, parseAppManifest, validateAppBundlePath } from '@radius/apps-sdk';
import { decodeAppText, validateAppBundleFiles } from '@radius/apps-sdk/release';
import { directoryNames, readBoundedFile, realDirectory, removeOwnedTree, snapshotBundle, snapshotDirectoryFiles, validateDirectoryFiles, writeSnapshotFiles } from './bundle.mjs';

export const AUTHORING_LIMITS = Object.freeze({ metadataBytes: 64 * 1024, apps: 256, slugLength: 64 });
export const TEMPLATES = Object.freeze(['interactive', 'background-action', 'scheduled-agent']);
export const USAGE = `Usage:
  pnpm app validate [slug]
  pnpm app build [slug]
  pnpm app create <slug> --template interactive|background-action|scheduled-agent
  pnpm app install <slug>

validate/build without a slug process all apps. Build copies only bundle/.
install builds locally and prints review/install commands; it never runs Radius,
approves grants, enables schedules, invokes agents, or installs dependencies.
Node app tests are trusted developer code, NOT a security sandbox.`;
const fail = (message, code = 'INVALID_ARGUMENT') => { throw new AppContractError(code, message); };
const check = (condition, message) => { if (!condition) fail(message); };
const own = (value, key) => Object.hasOwn(value, key);

export function validateSlug(value) {
  check(typeof value === 'string' && value.length <= AUTHORING_LIMITS.slugLength && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value), 'Invalid app slug; use at most 64 lowercase letters, digits and single hyphens, starting with a letter');
  validateAppBundlePath(value);
  return value;
}

function record(value, allowed, required = allowed) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected metadata object');
  for (const key of Object.keys(value)) check(allowed.includes(key), `Unsupported metadata field: ${key}`);
  for (const key of required) check(own(value, key), `Missing metadata field: ${key}`);
  return value;
}

function text(value, label, maximum) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/u.test(value), `Invalid metadata ${label}`);
  return value;
}

function uniqueStrings(value, label, maximum, validate) {
  check(Array.isArray(value) && value.length <= maximum, `Invalid metadata ${label}`);
  const seen = new Set();
  for (const item of value) {
    validate(item);
    const key = item.toLowerCase();
    check(!seen.has(key), `Duplicate metadata ${label}`);
    seen.add(key);
  }
}

/** Local authoring schema. License/screenshot presence and publication license
 * policy belong to the release gate, not local development. Validating a license
 * identifier neither selects a license nor grants rights to publish. */
export function validateMetadata(value, expectedSlug) {
  const source = canonicalAppJson(value);
  check(Buffer.byteLength(source) <= AUTHORING_LIMITS.metadataBytes, 'Metadata exceeds byte limit');
  const metadata = record(parseAppJson(source), ['schemaVersion', 'slug', 'title', 'summary', 'status', 'license', 'authors', 'categories', 'screenshots'], ['schemaVersion', 'slug', 'title', 'summary', 'status', 'authors', 'categories']);
  check(metadata.schemaVersion === 1, 'Unsupported metadata schemaVersion');
  validateSlug(metadata.slug);
  if (expectedSlug !== undefined) check(metadata.slug === validateSlug(expectedSlug), 'Metadata slug must match its app directory');
  text(metadata.title, 'title', 120);
  text(metadata.summary, 'summary', 1000);
  check(['experimental', 'ready'].includes(metadata.status), 'Invalid metadata status');
  if (own(metadata, 'license')) text(metadata.license, 'license identifier', 128);
  check(Array.isArray(metadata.authors) && metadata.authors.length > 0 && metadata.authors.length <= 16, 'Invalid metadata authors');
  const authors = new Set();
  for (const author of metadata.authors) {
    record(author, ['name']);
    const name = text(author.name, 'author name', 120).trim().toLowerCase();
    check(!authors.has(name), 'Duplicate metadata author');
    authors.add(name);
  }
  uniqueStrings(metadata.categories, 'categories', 16, (value) => {
    text(value, 'category', 64);
    check(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value), 'Invalid metadata category');
  });
  if (own(metadata, 'screenshots')) uniqueStrings(metadata.screenshots, 'screenshots', 12, (value) => {
    validateAppBundlePath(value);
    check(/\.(?:png|jpg|jpeg|webp)$/i.test(value), 'Screenshot must be a local image path');
  });
  return metadata;
}

async function readJson(path, maximum) {
  return parseAppJson(decodeAppText((await readBoundedFile(path, maximum)).bytes));
}

async function appDirectories(root) {
  const directory = await realDirectory(join(root, 'apps'));
  const names = await directoryNames(directory, AUTHORING_LIMITS.apps);
  const result = [];
  for (const slug of names) {
    validateSlug(slug);
    result.push({ slug, directory: await realDirectory(join(directory, slug)) });
  }
  return result;
}

/** Read metadata and bundle as data only. For all-app validation, any error
 * aborts before a build starts writing its first output directory. */
export async function validateApps(root = process.cwd(), slug) {
  if (slug !== undefined) validateSlug(slug);
  const apps = await appDirectories(root);
  if (slug !== undefined) check(apps.some((app) => app.slug === slug), `Unknown app slug: ${slug}`);
  const ids = new Set();
  const result = [];
  for (const app of apps) {
    const selected = slug === undefined || slug === app.slug;
    const bundleDirectory = await realDirectory(join(app.directory, 'bundle'));
    // Even a single-app command checks global identity uniqueness, but it does
    // not read unrelated app assets or execute their tests.
    const bundle = selected ? await snapshotBundle(bundleDirectory) : {
      manifest: parseAppManifest(await readJson(join(bundleDirectory, 'radius-app.json'), APP_MANIFEST_LIMITS.bytes)),
    };
    check(!ids.has(bundle.manifest.id), `Duplicate app ID: ${bundle.manifest.id}`);
    ids.add(bundle.manifest.id);
    if (selected) {
      const metadata = validateMetadata(await readJson(join(app.directory, 'app.json'), AUTHORING_LIMITS.metadataBytes), app.slug);
      result.push({ ...app, metadata, ...bundle });
    }
  }
  return result;
}

async function ensureChildDirectory(parent, name) {
  const directory = join(await realDirectory(parent), name);
  try { await fs.mkdir(directory, { mode: 0o755 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return realDirectory(directory);
}

async function exists(path) {
  try { await fs.lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function publishBuild(parent, app) {
  const destination = join(parent, app.slug);
  // Cooperative per-slug exclusion; a crashed writer's lock is intentionally
  // not guessed away. It must be inspected and removed by the developer.
  const lock = join(parent, `.${app.slug}.build-lock`);
  try { await fs.mkdir(lock, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') fail(`Build lock exists: ${lock}; check for another writer before removing it`, 'CONFLICT');
    throw error;
  }
  let stage;
  let backup;
  let published = false;
  try {
    if (await exists(destination)) {
      const existing = await snapshotBundle(destination);
      if (existing.digest === app.digest) return { ...app, output: destination };
    }
    stage = await fs.mkdtemp(join(parent, `.${app.slug}.pending-`));
    await writeSnapshotFiles(stage, app.files, { readonly: true });
    check((await snapshotBundle(stage)).digest === app.digest, 'Staged bundle digest mismatch');
    if (await exists(destination)) {
      // A rename pair has a brief missing-path window on replacement. No
      // partially written tree is exposed. Release version mappings are owned
      // by the separate publication pipeline, not this rebuildable dev output.
      // Keep the parent unchanged: macOS cannot move a read-only directory to
      // another parent (updating its '..' entry requires directory write access).
      const previous = join(parent, `.${app.slug}.previous-${randomUUID()}`);
      check(!await exists(previous), 'Build backup path already exists');
      await fs.rename(destination, previous);
      backup = previous;
    }
    try { await fs.rename(stage, destination); } catch (error) {
      if (backup) { await fs.rename(backup, destination); backup = undefined; }
      throw error;
    }
    stage = undefined;
    published = true;
    return { ...app, output: destination };
  } finally {
    if (stage) await removeOwnedTree(stage);
    if (backup && published) await removeOwnedTree(backup);
    // Preserve a previous output and the lock if a failed rollback requires
    // manual recovery. Never erase the sole surviving good build on failure.
    if (!backup || published) await fs.rmdir(lock);
  }
}

export async function buildApps(root = process.cwd(), slug) {
  const apps = await validateApps(root, slug);
  if (apps.length === 0) return [];
  const dist = await ensureChildDirectory(root, 'dist');
  const output = await ensureChildDirectory(dist, 'apps');
  const result = [];
  for (const app of apps) result.push(await publishBuild(output, app));
  return result;
}

const encode = (value) => Buffer.from(value, 'utf8').toString('base64');
const jsonFile = (value) => encode(`${JSON.stringify(value, null, 2)}\n`);

export async function createApp(root, slug, template) {
  validateSlug(slug);
  check(TEMPLATES.includes(template), 'Unknown template; choose interactive, background-action or scheduled-agent');
  root = await realDirectory(root);
  const templateRoot = await realDirectory(join(root, 'templates'));
  const files = await snapshotDirectoryFiles(join(templateRoot, template));
  const bundleFiles = Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('bundle/')).map(([name, data]) => [name.slice('bundle/'.length), data]));
  const { manifest } = validateAppBundleFiles(bundleFiles);
  const title = slug.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
  const oldName = manifest.name;
  const originalMetadata = own(files, 'app.json') ? validateMetadata(parseAppJson(decodeAppText(Buffer.from(files['app.json'], 'base64')))) : {
    schemaVersion: 1, slug, title, summary: `Experimental ${template} app. Review the README for host support and permission requirements.`,
    status: 'experimental', license: 'UNLICENSED', authors: [{ name: 'Your name' }], categories: [], screenshots: [],
  };
  const metadata = validateMetadata({ ...originalMetadata, slug, title, status: 'experimental', license: originalMetadata.license ?? 'UNLICENSED' }, slug);
  const nextManifest = { ...manifest, id: `local.${slug}`, name: title, version: '0.1.0' };
  for (const view of Object.values(nextManifest.provides.views)) view.title = view.title.replaceAll(oldName, title);
  for (const action of Object.values(nextManifest.provides.actions)) action.title = action.title.replaceAll(oldName, title);
  bundleFiles['radius-app.json'] = jsonFile(nextManifest);
  const checked = validateAppBundleFiles(bundleFiles);
  files['app.json'] = jsonFile(metadata);
  files['bundle/radius-app.json'] = bundleFiles['radius-app.json'];
  files['README.md'] = own(files, 'README.md')
    ? encode(decodeAppText(Buffer.from(files['README.md'], 'base64')).replaceAll(oldName, title))
    : encode(`# ${title}\n\nExperimental ${template} scaffold. Edit app.json and bundle/radius-app.json, then run pnpm app validate ${slug}.\n\nNo permissions or schedules are enabled by creation or build. Agent generation and native chat.draft remain unavailable on the current experimental host. Node tests are not a security sandbox.\n`);
  if (!own(files, 'CHANGELOG.md')) files['CHANGELOG.md'] = encode('# Changelog\n\n## 0.1.0\n\n- Initial local scaffold. Not published.\n');
  if (!Object.keys(files).some((name) => /^test\/[^/]+\.test\.mjs$/.test(name))) files['test/contract.test.mjs'] = encode(`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport { parseAppJson, parseAppManifest } from '@radius/apps-sdk';\n\n// Contract check only. Node tests are trusted code, not a security sandbox.\ntest('manifest is valid', async () => {\n  const source = await readFile(new URL('../bundle/radius-app.json', import.meta.url), 'utf8');\n  assert.equal(parseAppManifest(parseAppJson(source)).schemaVersion, 2);\n});\n`);
  validateDirectoryFiles(files);
  // Validate every identity before the first write, including collisions with
  // existing apps. No shell interpolation or arbitrary template path is used.
  const appRoot = join(root, 'apps');
  if (await exists(appRoot)) {
    for (const app of await appDirectories(root)) {
      check(app.slug !== slug, `App already exists: ${slug}`);
      const siblingBundle = await realDirectory(join(app.directory, 'bundle'));
      const sibling = parseAppManifest(await readJson(join(siblingBundle, 'radius-app.json'), APP_MANIFEST_LIMITS.bytes));
      check(sibling.id !== checked.manifest.id, `Duplicate app ID: ${checked.manifest.id}`);
    }
  }
  const apps = await ensureChildDirectory(root, 'apps');
  const destination = join(apps, slug);
  // Exclusive creation means even an existing empty directory is not replaced.
  await fs.mkdir(destination, { mode: 0o700 });
  try { await writeSnapshotFiles(destination, files); } catch (error) {
    await removeOwnedTree(destination);
    throw error;
  }
  return { slug, directory: destination, manifest: checked.manifest, metadata };
}

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
export function installGuidance(app) {
  const input = shellQuote(canonicalAppJson({ path: app.output }));
  return `Built ${app.slug} (${app.digest}). Nothing was installed.\nReview with a separately running Radius instance:\n  radius apps call apps.review --input ${input} --json\nAfter reviewing the matching digest, install with no grants:\n  radius apps install ${shellQuote(app.output)} --expected-digest ${app.digest} --grant '' --allow-agent-invocation false --json\nNo grants are approved, schedules enabled, or agents invoked by this tool.\nAdd --instance/--profile explicitly to both commands if needed for the intended Radius profile.`;
}

function warnings(app, log) {
  const capabilities = Object.values(app.manifest.requires).map((requirement) => requirement.capability);
  if (capabilities.includes('agent.run')) log(`${app.slug}: agent generation is unavailable on the current experimental host; schema validity does not imply runtime support.`);
  if (capabilities.includes('chat.draft')) log(`${app.slug}: native chat.draft is unavailable on the current experimental host.`);
}

/** Injectable output/root for tests; no child-process or network APIs. */
export async function runCli(argv, { root = process.cwd(), log = console.log } = {}) {
  if (argv.length === 0 || (argv.length === 1 && ['help', '--help', '-h'].includes(argv[0]))) { log(USAGE); return; }
  const [command, ...args] = argv;
  if (['validate', 'build', 'install'].includes(command)) {
    check(args.length <= 1 && (command !== 'install' || args.length === 1), `Invalid arguments for ${command}\n${USAGE}`);
    if (args.length) validateSlug(args[0]);
    const apps = await (command === 'validate' ? validateApps(root, args[0]) : buildApps(root, args[0]));
    for (const app of apps) {
      log(command === 'install' ? installGuidance(app) : `${command === 'build' ? 'Built' : 'Validated'} ${app.slug} ${app.manifest.version} ${app.digest}${app.output ? ` -> ${app.output}` : ''}`);
      warnings(app, log);
    }
    if (!apps.length) log('No apps found.');
    return;
  }
  if (command === 'create') {
    check(args.length === 3 && args[1] === '--template', `Invalid create arguments\n${USAGE}`);
    const app = await createApp(root, args[0], args[2]);
    log(`Created ${app.directory}\nNext: pnpm app validate ${app.slug}\nNo dependencies installed, permissions granted, schedules enabled, or agents invoked.`);
    warnings(app, log);
    return;
  }
  fail(`Unknown command: ${command}\n${USAGE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(`${error.code ?? 'ERROR'}: ${error.message}`);
    process.exitCode = 1;
  });
}
