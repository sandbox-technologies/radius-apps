import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = name => fs.readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
const pins = new Set([
  'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
]);

test('all workflow actions are fixed verified commit pins with read-only permissions', async () => {
  for (const name of ['validate', 'release']) {
    const source = await read(name);
    for (const match of source.matchAll(/uses:\s*(\S+)/g)) assert.ok(pins.has(match[1]), `Unreviewed action pin: ${match[1]}`);
    assert.match(source, /permissions:\n  contents: read/);
    assert.doesNotMatch(source, /contents: write|id-token: write|pull_request_target:|workflow_run:|persist-credentials: true|secrets: inherit/);
    assert.equal((source.match(/uses: actions\/checkout@/g) ?? []).length, (source.match(/persist-credentials: false/g) ?? []).length);
    assert.equal((source.match(/uses: actions\/checkout@/g) ?? []).length, (source.match(/ref: \$\{\{ github.sha \}\}/g) ?? []).length);
  }
});

test('untrusted validation has no secrets, environment, reusable cache or release artifact', async () => {
  const source = await read('validate');
  assert.match(source, /pull_request:/);
  assert.match(source, /pnpm install --ignore-scripts --frozen-lockfile/);
  assert.doesNotMatch(source, /\$\{\{\s*secrets\.|^\s+environment:|uses: actions\/(?:upload-artifact|cache)/m);
});

test('release binds both jobs to default workflow commit; signing has no app tests or install hooks', async () => {
  const source = await read('release');
  assert.equal((source.match(/inputs.reviewed_commit == github.sha/g) ?? []).length, 2);
  assert.equal((source.match(/github.event.repository.default_branch/g) ?? []).length, 2);
  assert.match(source, /environment: release-signing/);
  const signing = source.split('\n  sign:\n')[1];
  assert.ok(signing);
  assert.doesNotMatch(signing, /pnpm |npm (?:install|run|test)|node --test|app(s)?\.mjs/);
  assert.match(signing, /delete process.env.RADIUS_PRIVATE_KEY_PEM/);
  assert.match(signing, /finally \{ await fs.rm\(keyPath/);
  assert.match(signing, /--previous-sha256 "\$BASELINE_SHA256"/);
  assert.match(signing, /--trusted-keys catalog\/trusted-keys.json/);
  assert.doesNotMatch(source, /ref: \$\{\{ inputs\./);
  assert.equal((source.match(/\$\{\{ secrets\./g) ?? []).length, 1);
});
