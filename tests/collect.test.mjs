import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { collect, compareSnapshots } from '../skills/project-align/scripts/collect.mjs';

test('missing baseline and disappeared issues never imply completion', () => {
  assert.equal(compareSnapshots(null, {}).baseline, 'missing-or-different-repository');
  const delta = compareSnapshots({ identity: 'a/b', github: { issues: [{ number: 1 }] } }, { identity: 'a/b', github: { issues: [] } });
  assert.match(delta.removed[0].meaning, /verify individually/);
});
test('new items have a delta and an unavailable inventory has no removals', () => {
  const baseline = { identity: 'a/b', github: { issues: [{ number: 1 }], prs: [] } };
  const current = { identity: 'a/b', github: { issues: [{ number: 1 }, { number: 2 }], prs: [] } };
  assert.equal(compareSnapshots(baseline, current).changed[0].number, 2);
  const outage = compareSnapshots(baseline, { identity: 'a/b', github: {} });
  assert.equal(outage.removed.length, 0);
  assert.deepEqual(outage.unavailable, ['issues', 'prs']);
});
test('offline discovery works in a path containing spaces without reading private exports', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project align '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  await fs.mkdir(path.join(root, 'docs/private'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs/private/transcript.json'), 'DO-NOT-INCLUDE-THIS-CONTENT');
  const result = await collect({ repo: root, offline: true });
  assert.equal(result.root, await fs.realpath(root));
  assert.equal(result.coverage.find(c => c.source === 'github').state, 'not-requested');
  assert.ok(!JSON.stringify(result).includes('DO-NOT-INCLUDE'));
});
test('auth failure is unavailable coverage, not an empty healthy queue', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'align-auth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/example/project.git']);
  const result = await collect({ repo: root }, async (bin) => { if (bin === 'gh') throw Error('secret reason'); return ''; });
  assert.equal(result.github.issues, undefined);
  assert.equal(result.coverage.find(c => c.source === 'issues').state, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('secret reason'));
});
