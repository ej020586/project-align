import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('packed npm artifact installs all runtime copies and preserves a project through rerun/detach', { timeout: 120000 }, async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'align packed '));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const npm = process.env.npm_execpath;
  if (!npm) { t.skip('Run via npm test to provide the cross-platform npm entry point.'); return; }
  const run = (bin, args, cwd = source) => execFileSync(bin, args, { cwd, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' } });
  const packed = JSON.parse(run(process.execPath, [npm, 'pack', '--ignore-scripts', '--pack-destination', base, '--json']));
  const app = path.join(base, 'installed package');
  await fs.mkdir(app);
  await fs.writeFile(path.join(app, 'package.json'), '{"private":true}');
  run(process.execPath, [npm, 'install', path.join(base, packed[0].filename), '--ignore-scripts', '--no-audit', '--no-fund'], app);
  const bin = path.join(app, 'node_modules/@ej020586/project-align/cli/project-align.mjs');
  const repo = path.join(base, 'fresh project'); await fs.mkdir(repo);
  run('git', ['init', '-q', repo]);
  await fs.writeFile(path.join(repo, 'AGENTS.md'), 'Keep existing guidance.\n');
  const args = [bin, 'setup', '--repo', repo, '--agents', 'codex', 'claude-code', 'cursor'];
  assert.equal(JSON.parse(run(process.execPath, args)).authority, 'assess');
  const before = await fs.readFile(path.join(repo, 'AGENTS.md'), 'utf8');
  run(process.execPath, args);
  assert.equal(await fs.readFile(path.join(repo, 'AGENTS.md'), 'utf8'), before);
  for (const directory of ['.agents', '.claude']) {
    const installed = path.join(repo, directory, 'skills/project-align');
    assert.match(await fs.readFile(path.join(installed, 'SKILL.md'), 'utf8'), /name: project-align/);
    const collected = JSON.parse(run(process.execPath, [path.join(installed, 'scripts/collect.mjs'), '--repo', repo, '--offline']));
    assert.equal(collected.coverage.find(c => c.source === 'github').state, 'not-requested');
  }
  const diagnosis = JSON.parse(run(process.execPath, [bin, 'doctor', '--repo', repo]));
  assert.equal(diagnosis.enrolled, true);
  assert.equal(diagnosis.installations.length, 3);
  assert.ok(diagnosis.installations.every(i => i.present));
  run(process.execPath, [bin, 'detach', '--repo', repo]);
  assert.equal(await fs.readFile(path.join(repo, 'AGENTS.md'), 'utf8'), 'Keep existing guidance.\n');
  assert.match(await fs.readFile(path.join(repo, 'docs/project-alignment.md'), 'utf8'), /Unresolved/);
});
