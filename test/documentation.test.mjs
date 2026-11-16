import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
async function markdown(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Contributor documentation must not follow symlinks');
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await markdown(path));
    else if (entry.name.endsWith('.md')) result.push(path);
  }
  return result;
}

test('contributor documentation links resolve inside the standalone repository', async () => {
  const files = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PUBLISHING.md'].map(name => join(root, name));
  for (const name of ['apps', 'templates', 'docs']) files.push(...await markdown(join(root, name)));
  for (const path of files) {
    const content = await readFile(path, 'utf8');
    for (const match of content.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
      const target = resolve(dirname(path), decodeURIComponent(link));
      const local = relative(root, target);
      assert(!local.startsWith(`..${sep}`) && local !== '..', `Link escapes standalone repo in ${path}`);
      await assert.doesNotReject(stat(target), `${relative(root, path)} links to missing ${link}`);
    }
    assert(!/\/(?:Users|home)\/[^/\s]+\//.test(content), `Documentation must not depend on the author's checkout: ${path}`);
  }
});

test('published app assets remain separate from contributor metadata and tests', async () => {
  for (const slug of await readdir(join(root, 'apps'))) {
    const folder = join(root, 'apps', slug);
    const metadata = JSON.parse(await readFile(join(folder, 'app.json'), 'utf8'));
    assert.equal(metadata.slug, slug);
    await stat(join(folder, 'README.md'));
    await stat(join(folder, 'CHANGELOG.md'));
    await stat(join(folder, 'test'));
    for (const entry of await readdir(join(folder, 'bundle'))) assert(!['app.json', 'package.json', 'node_modules', 'test', '.env'].includes(entry));
    for (const image of metadata.screenshots ?? []) {
      const target = resolve(folder, image);
      assert(!relative(folder, target).startsWith('..'), 'Screenshot escapes app folder');
      assert((await stat(target)).isFile(), 'Screenshot must exist before adding it to the catalog metadata');
    }
  }
});
