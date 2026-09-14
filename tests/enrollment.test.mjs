import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execute, parseArgs, installedPaths, safePath, run, PACKAGE_ROOT } from '../cli/enrollment.mjs';

async function fixture(t) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'project align test ')));
  const repo = path.join(temp, 'repo with spaces');
  const home = path.join(temp, 'fake home');
  await fs.mkdir(repo); await fs.mkdir(home);
  assert.equal(run('git', ['init', repo]).ok, true);
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  let installs = 0;
  const deps = { home, env: {}, exec: (cmd, args, opts) => cmd === 'git' ? run(cmd, args, opts) : ({ ok: false, stdout: '', stderr: 'secret must never be exposed' }), install: async ({ root, agents, global }) => {
    installs++;
    for (const item of installedPaths(root, agents, global, home, {})) { await fs.mkdir(path.dirname(item.path), { recursive: true }); await fs.cp(path.join(PACKAGE_ROOT, 'skills/project-align'), path.dirname(item.path), { recursive: true }); }
  } };
  const options = { command: 'setup', repo, agents: ['codex', 'claude-code', 'cursor'] };
  return { temp, repo, home, deps, options, installs: () => installs };
}

test('strict CLI options reject invalid or incomplete arguments', () => {
  for (const argv of [['unknown'], ['setup', '--agents'], ['setup', '--agents', 'invalid'], ['setup', '--repo'], ['setup', '--wat'], ['detach', '--maintenance'], ['setup', '--agents', 'codex', 'codex']]) assert.throws(() => parseArgs(argv));
  assert.deepEqual(parseArgs(['setup', '--repo', '/with spaces', '--agents', 'codex', 'cursor', '--global', '--maintenance']).agents, ['codex', 'cursor']);
});

test('setup preserves exact existing bytes; repeated enrollment and detach preserve later additions', async t => {
  const f = await fixture(t);
  const original = Buffer.from('# Existing instructions\r\nKeep this byte-for-byte.');
  await fs.writeFile(path.join(f.repo, 'AGENTS.md'), original);
  await execute(f.options, f.deps);
  const first = await fs.readFile(path.join(f.repo, 'AGENTS.md'));
  assert.ok(first.subarray(0, original.length).equals(original));
  assert.match(await fs.readFile(path.join(f.repo, 'docs/project-alignment.md'), 'utf8'), /Unresolved/);
  const manifest = await fs.readFile(path.join(f.repo, '.project-align/enrollment.json'));
  await execute(f.options, f.deps);
  assert.deepEqual(await fs.readFile(path.join(f.repo, 'AGENTS.md')), first);
  assert.deepEqual(await fs.readFile(path.join(f.repo, '.project-align/enrollment.json')), manifest);
  await fs.appendFile(path.join(f.repo, 'AGENTS.md'), '\nLater guidance.\n');
  await execute({ command: 'detach', repo: f.repo }, f.deps);
  assert.deepEqual(await fs.readFile(path.join(f.repo, 'AGENTS.md')), Buffer.concat([original, Buffer.from('\nLater guidance.\n')]));
  await assert.rejects(fs.access(path.join(f.repo, 'CLAUDE.md')));
  assert.ok(await fs.readFile(path.join(f.repo, 'docs/project-alignment.md')));
  assert.ok(await fs.readFile(installedPaths(f.repo, ['codex'], false)[0].path));
});

test('dry run changes no files and does not invoke installer', async t => {
  const f = await fixture(t);
  const before = await fs.readdir(f.repo);
  const result = await execute({ ...f.options, dryRun: true }, f.deps);
  assert.equal(result.dryRun, true);
  assert.deepEqual(await fs.readdir(f.repo), before);
  assert.equal(f.installs(), 0);
});

test('unknown authority stays assessment; maintenance is explicit; existing brief is preserved', async t => {
  const f = await fixture(t);
  await execute({ ...f.options, maintenance: true }, f.deps);
  const manifest = JSON.parse(await fs.readFile(path.join(f.repo, '.project-align/enrollment.json')));
  assert.equal(manifest.authority, 'maintenance');
  await execute({ command: 'detach', repo: f.repo }, f.deps);
  const brief = await fs.readFile(path.join(f.repo, 'docs/project-alignment.md'));
  await execute(f.options, f.deps);
  assert.deepEqual(await fs.readFile(path.join(f.repo, 'docs/project-alignment.md')), brief);
});

test('doctor reports missing access without logging auth details or installing', async t => {
  const f = await fixture(t);
  const report = await execute({ command: 'doctor', repo: f.repo, agents: ['codex'] }, f.deps);
  assert.equal(report.prerequisites.githubAuthenticated, false);
  assert.equal(report.installations[0].present, false);
  assert.equal(report.enrolled, false);
  assert.ok(!JSON.stringify(report).includes('secret'));
  assert.equal(f.installs(), 0);
});

test('global scope uses isolated provided home and each supported runtime destination', async t => {
  const f = await fixture(t);
  const report = await execute({ ...f.options, global: true }, f.deps);
  assert.ok(report.installations.every(item => item.path.startsWith(f.home)));
  assert.match(report.installations.find(i => i.agent === 'codex').path, /\.agents/);
  assert.match(report.installations.find(i => i.agent === 'cursor').path, /\.agents/);
  assert.equal((await execute({ command: 'doctor', repo: f.repo }, f.deps)).installations.every(i => i.present), true);
});

test('managed symlinks and root escapes fail before installer or writes', async t => {
  const f = await fixture(t);
  const outside = path.join(f.temp, 'outside.md');
  await fs.writeFile(outside, 'untouched');
  await fs.symlink(outside, path.join(f.repo, 'AGENTS.md'));
  await assert.rejects(execute(f.options, f.deps), /symlink/);
  assert.equal(f.installs(), 0);
  assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
  await assert.rejects(safePath(f.repo, '../outside'), /Unsafe/);
});

test('guidance drift blocks detach without losing local edits', async t => {
  const f = await fixture(t);
  await execute(f.options, f.deps);
  const file = path.join(f.repo, 'AGENTS.md');
  await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('invoke the project-align', 'custom change'));
  await assert.rejects(execute({ command: 'detach', repo: f.repo }, f.deps), /drift/);
  assert.match(await fs.readFile(file, 'utf8'), /custom change/);
});

test('interrupted transaction is retained; doctor is read-only; next setup finishes it', async t => {
  const f = await fixture(t);
  await assert.rejects(execute(f.options, { ...f.deps, hooks: { afterWrite: () => { throw new Error('simulated interruption'); } } }), /interruption/);
  const journal = path.join(f.repo, '.project-align/transaction.json');
  const before = await fs.readFile(journal);
  const report = await execute({ command: 'doctor', repo: f.repo }, f.deps);
  assert.equal(report.recovery, true);
  assert.deepEqual(await fs.readFile(journal), before);
  const recovered = await execute(f.options, f.deps);
  assert.equal(recovered.recovery, true);
  await assert.rejects(fs.access(journal));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.repo, '.project-align/enrollment.json'))).version, 1);
});

test('concurrent local edits stop the transaction and recovery never overwrites them', async t => {
  const f = await fixture(t);
  await assert.rejects(execute(f.options, { ...f.deps, hooks: { beforeApply: () => fs.writeFile(path.join(f.repo, 'AGENTS.md'), 'Other task changed this.') } }), /Concurrent edit/);
  await assert.rejects(execute(f.options, f.deps), /conflicts with newer changes/);
  assert.equal(await fs.readFile(path.join(f.repo, 'AGENTS.md'), 'utf8'), 'Other task changed this.');
  assert.ok(await fs.readFile(path.join(f.repo, '.project-align/transaction.json')));
});

test('failed or unverified install leaves enrollment untouched', async t => {
  const f = await fixture(t);
  await assert.rejects(execute(f.options, { ...f.deps, install: async () => {} }), /not verified/);
  await assert.rejects(fs.access(path.join(f.repo, 'AGENTS.md')));
  await assert.rejects(fs.access(path.join(f.repo, '.project-align/enrollment.json')));
});

test('another live operation cannot recover or install over an active transaction', async t => {
  const f = await fixture(t);
  await execute(f.options, { ...f.deps, hooks: { beforeApply: async () => {
    await assert.rejects(execute(f.options, f.deps), /still running/);
    assert.equal(f.installs(), 1);
  } } });
});

test('doctor detects changed installed content and setup preserves it', async t => {
  const f = await fixture(t);
  await execute(f.options, f.deps);
  const installed = installedPaths(f.repo, ['codex'], false)[0].path;
  await fs.appendFile(installed, '\nLocal customization.\n');
  const report = await execute({ command: 'doctor', repo: f.repo }, f.deps);
  assert.equal(report.installations.find(i => i.agent === 'codex').matchesCurrentPackage, false);
  await assert.rejects(execute(f.options, f.deps), /local changes/);
  assert.match(await fs.readFile(installed, 'utf8'), /Local customization/);
  assert.equal(f.installs(), 1);
});

test('recognized older installation upgrades while identical rerun skips copying', async t => {
  const f = await fixture(t);
  await execute(f.options, f.deps);
  await execute(f.options, f.deps);
  assert.equal(f.installs(), 1);
  const { skillFingerprint } = await import('../cli/enrollment.mjs');
  for (const target of new Set(installedPaths(f.repo, f.options.agents, false).map(i => path.dirname(i.path)))) {
    await fs.rm(target, { recursive: true }); await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'SKILL.md'), 'Recognized older skill version.');
  }
  const manifestPath = path.join(f.repo, '.project-align/enrollment.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath));
  manifest.installation = { version: '0.0.0', fingerprint: await skillFingerprint(path.dirname(installedPaths(f.repo, ['codex'], false)[0].path)) };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await execute(f.options, f.deps);
  assert.equal(f.installs(), 2);
  const report = await execute({ command: 'doctor', repo: f.repo }, f.deps);
  assert.ok(report.installations.every(i => i.matchesCurrentPackage));
});

test('real bundled Skills CLI installs complete copies without retaining a machine-specific lock', async t => {
  const f = await fixture(t);
  const dependencies = { ...f.deps, install: undefined, exec: (command, args, options) => command === process.execPath ? run(command, args, options) : f.deps.exec(command, args, options) };
  await execute(f.options, dependencies);
  await assert.rejects(fs.access(path.join(f.repo, 'skills-lock.json')));
  const doctor = await execute({ command: 'doctor', repo: f.repo }, dependencies);
  assert.ok(doctor.installations.every(item => item.matchesCurrentPackage));
  await execute({ command: 'detach', repo: f.repo }, dependencies);
  const original = '{\n "version": 1, "skills": {"another-skill":{"source":"example/skills","sourceType":"github","computedHash":"abc"}}\n}\n';
  await fs.writeFile(path.join(f.repo, 'skills-lock.json'), original);
  for (const target of new Set(installedPaths(f.repo, f.options.agents, false).map(i => path.dirname(i.path)))) await fs.rm(target, { recursive: true });
  await execute(f.options, dependencies);
  assert.equal(await fs.readFile(path.join(f.repo, 'skills-lock.json'), 'utf8'), original);
});

test('global universal destinations agree with the actual pinned Skills CLI resolver', async () => {
  const { createRequire } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const require = createRequire(import.meta.url);
  const source = await fs.readFile(path.join(path.dirname(require.resolve('skills/bin/cli.mjs')), '../dist/cli.mjs'), 'utf8');
  const extract = name => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  };
  const home = path.resolve('isolated-example-home');
  const agents = Object.fromEntries(['codex', 'cursor'].map(agent => {
    const match = source.match(new RegExp(`(?:${agent}|"${agent}"):\\s*\\{[\\s\\S]*?skillsDir:\\s*"([^"]+)"`));
    assert.ok(match);
    return [agent, { skillsDir: match[1], globalSkillsDir: path.join(home, `.${agent}`, 'skills') }];
  }));
  const resolver = runInNewContext(`${extract('isUniversalAgent')}\n${extract('getCanonicalSkillsDir')}\n${extract('getAgentBaseDir')}\ngetAgentBaseDir`, { agents, join: path.join, homedir: () => home, AGENTS_DIR$1: '.agents', SKILLS_SUBDIR: 'skills' });
  for (const agent of ['codex', 'cursor']) {
    const expected = path.join(resolver(agent, true), 'project-align/SKILL.md');
    assert.equal(installedPaths('/unused', [agent], true, home, { CODEX_HOME: '/must-not-affect-universal' })[0].path, expected);
  }
});

test('recovery cannot enroll guidance when installation did not finish', async t => {
  const f = await fixture(t);
  await assert.rejects(execute(f.options, { ...f.deps, install: async () => {} }), /not verified/);
  await assert.rejects(execute(f.options, f.deps), /installation is incomplete/);
  await assert.rejects(fs.access(path.join(f.repo, 'AGENTS.md')));
  await assert.rejects(fs.access(path.join(f.repo, '.project-align/enrollment.json')));
  assert.ok(await fs.readFile(path.join(f.repo, '.project-align/transaction.json')));
});
