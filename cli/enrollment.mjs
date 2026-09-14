import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';

export const AGENTS = ['codex', 'claude-code', 'cursor'];
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = '.project-align/enrollment.json';
const JOURNAL = '.project-align/transaction.json';
const START = '<!-- project-align:start -->';
const END = '<!-- project-align:end -->';
const GUIDANCE = `${START}\nWhen resuming development, invoke the project-align skill in resume mode before choosing work. Before ending or interrupting development, invoke its handoff mode. Run each transition once per task, even if another runtime instruction also requests it. Read docs/project-alignment.md for accepted intent and maintenance authority; unknown intent remains unresolved. If the skill is unavailable, report the gap and use the project brief without inventing decisions.\n${END}`;
const adapter = { codex: 'AGENTS.md', 'claude-code': 'CLAUDE.md', cursor: '.cursor/rules/project-align.mdc' };
const IGNORE = '# project-align:start\n.project-align/transaction.json\n.project-align-*.tmp\n# project-align:end';
const MANAGED_PATHS = [...Object.values(adapter), '.gitignore'];
const cursorHeader = '---\ndescription: Project Align resume and handoff guidance\nalwaysApply: true\n---\n\n';
const encode = value => value === null ? null : Buffer.from(value).toString('base64');
const decode = value => value === null ? null : Buffer.from(value, 'base64');
const equal = (a, b) => a === null || b === null ? a === b : a.equals(b);

export function parseArgs(argv) {
  const command = argv[0] || 'help';
  if (!['setup', 'doctor', 'detach', 'help', '--help', '--version'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const result = { command, repo: '.', agents: null, global: false, dryRun: false, maintenance: false };
  const seen = new Set();
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--repo') { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--repo requires a path'); result.repo = argv[++i]; }
    else if (arg === '--agents') {
      const agents = [];
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) agents.push(argv[++i]);
      if (!agents.length || agents.some(a => !AGENTS.includes(a)) || new Set(agents).size !== agents.length) throw new Error('--agents requires unique supported names: codex claude-code cursor');
      result.agents = agents;
    } else if (arg === '--global') result.global = true;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--maintenance' && command === 'setup') result.maintenance = true;
    else throw new Error(`Unknown or unsupported option: ${arg}`);
  }
  if (['detach', 'help', '--help', '--version'].includes(command) && (result.agents || result.global || result.maintenance)) throw new Error(`${command} does not accept installation options`);
  return result;
}

export function run(command, args, options = {}) {
  const value = spawnSync(command, args, { encoding: 'utf8', timeout: 20000, windowsHide: true, ...options });
  return { ok: !value.error && value.status === 0, status: value.status, stdout: value.stdout || '', stderr: value.stderr || '' };
}
async function read(file) { try { return await fs.readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
export async function safePath(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`Unsafe managed path: ${relative}`);
  const target = path.resolve(root, relative);
  if (target === root || !target.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) throw new Error(`Managed path escapes repository: ${relative}`);
  const parts = path.relative(root, target).split(path.sep);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Refusing symlink in managed path: ${relative}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}
async function managedRead(root, relative) { return read(await safePath(root, relative)); }
async function atomic(root, relative, content) {
  const target = await safePath(root, relative);
  if (content === null) { await fs.rm(target, { force: true }); return; }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await safePath(root, relative);
  const temp = path.join(path.dirname(target), `.project-align-${randomUUID()}.tmp`);
  const mode = await fs.stat(target).then(info => info.mode & 0o777, () => 0o644);
  try { await fs.writeFile(temp, content, { flag: 'wx', mode }); await safePath(root, relative); await fs.rename(temp, target); }
  finally { await fs.rm(temp, { force: true }); }
}
async function rootFor(repo, exec) {
  const requested = path.resolve(repo);
  if ((await fs.lstat(requested)).isSymbolicLink()) throw new Error('Repository path must not be a symlink');
  const root = await fs.realpath(requested);
  const git = exec('git', ['-C', root, 'rev-parse', '--show-toplevel']);
  if (!git.ok || await fs.realpath(git.stdout.trim()) !== root) throw new Error('--repo must point to the root of a Git repository');
  return root;
}
async function readManifest(root) {
  const bytes = await managedRead(root, MANIFEST);
  if (!bytes) return null;
  const value = JSON.parse(bytes);
  if (value.version !== 1 || !Array.isArray(value.files) || !Array.isArray(value.agents) || value.agents.some(a => !AGENTS.includes(a)) || !['project', 'global'].includes(value.scope)) throw new Error('Unsupported or invalid enrollment manifest');
  for (const file of value.files) {
    const snippet = file.path === '.gitignore' ? IGNORE : GUIDANCE;
    const allowed = ['', '\n', '\n\n', ...(file.path === adapter.cursor ? [cursorHeader] : [])].map(prefix => prefix + snippet + '\n');
    if (!MANAGED_PATHS.includes(file.path) || !allowed.includes(file.added) || typeof file.existed !== 'boolean') throw new Error('Invalid managed guidance manifest');
  }
  if (new Set(value.files.map(file => file.path)).size !== value.files.length || new Set(value.agents).size !== value.agents.length || !['assess', 'maintenance'].includes(value.authority)) throw new Error('Invalid enrollment manifest');
  return value;
}
async function recover(root, dryRun) {
  const bytes = await managedRead(root, JOURNAL);
  if (!bytes) return false;
  const journal = JSON.parse(bytes);
  if (journal.version !== 1 || !Array.isArray(journal.edits)) throw new Error('Invalid recovery journal; inspect .project-align/transaction.json');
  for (const edit of journal.edits) {
    if (![MANIFEST, 'docs/project-alignment.md', ...MANAGED_PATHS].includes(edit.path)) throw new Error('Invalid recovery journal path');
    const current = await managedRead(root, edit.path);
    if (!equal(current, decode(edit.before)) && !equal(current, decode(edit.after))) throw new Error(`Interrupted transaction conflicts with newer changes: ${edit.path}. Preserve the journal and reconcile manually.`);
  }
  if (dryRun) return true;
  if (journal.owner && journal.owner.active !== false) {
    if (journal.owner.host !== os.hostname()) throw new Error('Recovery journal belongs to another host; confirm that operation has stopped before reconciling it.');
    let live = false;
    if (Number.isInteger(journal.owner.pid) && journal.owner.pid > 0) { try { process.kill(journal.owner.pid, 0); live = true; } catch (error) { live = error.code === 'EPERM'; } }
    if (live) throw new Error('Another Project Align operation owns the recovery journal and is still running.');
  }
  if (journal.installationLock) await restoreSkillsLock(root, journal.installationLock);
  for (const edit of journal.edits) {
    const current = await managedRead(root, edit.path);
    if (equal(current, decode(edit.after))) continue;
    if (!equal(current, decode(edit.before))) throw new Error(`Concurrent edit during recovery: ${edit.path}`);
    await atomic(root, edit.path, decode(edit.after));
  }
  await fs.unlink(await safePath(root, JOURNAL));
  return true;
}
async function transaction(root, edits, hooks = {}) {
  edits = edits.filter(edit => !equal(edit.before, edit.after));
  if (!edits.length && !hooks.beforeApply) return;
  // Check the complete read set before recording intent. Keep the journal if a later check fails.
  for (const edit of edits) if (!equal(await managedRead(root, edit.path), edit.before)) throw new Error(`Concurrent edit: ${edit.path}`);
  const journalPath = await safePath(root, JOURNAL);
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, JSON.stringify({ version: 1, owner: { pid: process.pid, host: os.hostname() }, edits: edits.map(e => ({ path: e.path, before: encode(e.before), after: encode(e.after) })) }, null, 2), { flag: 'wx', mode: 0o600 });
  try {
  await hooks.beforeApply?.();
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index];
    if (!equal(await managedRead(root, edit.path), edit.before)) throw new Error(`Concurrent edit: ${edit.path}; recovery journal retained`);
    await atomic(root, edit.path, edit.after);
    await hooks.afterWrite?.(index, edit.path);
    if (!equal(await managedRead(root, edit.path), edit.after)) throw new Error(`Write verification failed: ${edit.path}; recovery journal retained`);
  }
  await fs.unlink(journalPath);
  } catch (error) {
    // This invocation has stopped. A killed process instead leaves its PID for liveness checks.
    try { const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')); journal.owner.active = false; await fs.writeFile(journalPath, JSON.stringify(journal, null, 2), { mode: 0o600 }); } catch {}
    throw error;
  }
}
export function installedPaths(root, agents, global, home = os.homedir(), env = process.env) {
  return agents.map(agent => {
    const base = global ? (agent === 'codex' ? (env.CODEX_HOME?.trim() || path.join(home, '.codex')) : agent === 'claude-code' ? (env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, '.claude')) : path.join(home, '.cursor')) : path.join(root, agent === 'claude-code' ? '.claude' : '.agents');
    return { agent, path: path.join(base, 'skills/project-align/SKILL.md') };
  });
}
async function detect(root, home, exec) {
  const checks = await Promise.all(AGENTS.map(async agent => {
    const marker = agent === 'claude-code' ? '.claude' : `.${agent}`;
    return [agent, !!await read(path.join(root, adapter[agent])) || await fs.stat(path.join(home, marker)).then(() => true, () => false) || exec(agent === 'claude-code' ? 'claude' : agent, ['--version']).ok];
  }));
  const found = checks.filter(([, yes]) => yes).map(([agent]) => agent);
  return found.length ? found : [...AGENTS];
}
async function restoreSkillsLock(root, snapshot) {
  const current = await managedRead(root, 'skills-lock.json');
  const before = decode(snapshot.before);
  if (equal(current, before)) return;
  if (!current) throw new Error('Skills lock changed concurrently; recovery journal retained.');
  const currentValue = JSON.parse(current);
  const priorValue = before ? JSON.parse(before) : { version: 1, skills: {} };
  const entry = currentValue.skills?.['project-align'];
  if (!entry || entry.sourceType !== 'local' || path.resolve(root, entry.source) !== snapshot.source) throw new Error('Skills lock has an unexpected Project Align entry; recovery journal retained.');
  const withoutOwn = value => { const copy = structuredClone(value); delete copy.skills?.['project-align']; return JSON.stringify(copy); };
  if (withoutOwn(currentValue) !== withoutOwn(priorValue)) throw new Error('Skills lock changed concurrently; recovery journal retained.');
  if (!equal(await managedRead(root, 'skills-lock.json'), current)) throw new Error('Concurrent Skills lock edit; recovery journal retained.');
  await atomic(root, 'skills-lock.json', before);
}
export async function installSkill({ root, agents, global, exec = run }) {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('skills/bin/cli.mjs');
  const args = [entry, 'add', PACKAGE_ROOT, '--skill', 'project-align', '--agent', ...agents, '--copy', '--yes', ...(global ? ['--global'] : [])];
  let snapshot;
  if (!global) {
    snapshot = { before: encode(await managedRead(root, 'skills-lock.json')), source: PACKAGE_ROOT };
    const journal = JSON.parse(await fs.readFile(await safePath(root, JOURNAL), 'utf8'));
    journal.installationLock = snapshot;
    await atomic(root, JOURNAL, Buffer.from(JSON.stringify(journal, null, 2)));
  }
  const result = exec(process.execPath, args, { cwd: root, timeout: 120000, env: { ...process.env, DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' } });
  if (snapshot) await restoreSkillsLock(root, snapshot);
  if (!result.ok) throw new Error('Skills CLI installation failed; enrollment was not changed. Inspect the installed skill before retrying.');
}

export async function skillFingerprint(directory) {
  try { await fs.lstat(directory); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const hash = createHash('sha256');
  async function walk(dir, prefix = '') {
    const stat = await fs.lstat(dir);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in installed skill: ${dir}`);
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in skill: ${relative}`);
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative + '/');
      else if (entry.isFile()) { hash.update(relative + '\0'); hash.update(await fs.readFile(path.join(dir, entry.name))); hash.update('\0'); }
      else throw new Error(`Unsupported file in skill: ${relative}`);
    }
  }
  await walk(directory);
  return hash.digest('hex');
}
async function bundleIdentity() {
  return { version: JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version, fingerprint: await skillFingerprint(path.join(PACKAGE_ROOT, 'skills/project-align')) };
}

const initialBrief = maintenance => `# Project alignment\n\n## Objective\n\nUnresolved. Recover an explicitly accepted objective from project evidence or ask the owner.\n\n## Accepted constraints and decisions\n\nUnresolved. Link accepted decisions separately from proposals.\n\n## Active work\n\nNot yet assessed. Link current issues, PRs, worktrees, and evidence after the first assessment.\n\n## Maintenance authority\n\n${maintenance ? 'The enrolling user selected maintenance: groom, link, create missing follow-ups, and reconcile issue status when complete evidence supports the change. Priorities remain human decisions. Closure requires the actual acceptance criteria; ambiguous status enters the decision queue.' : 'Assessment and local handoffs only. Remote record maintenance requires explicit user authorization. Installation does not authorize issue or PR changes.'}\n\n## Latest handoffs\n\nNo handoff recorded. Store task-specific continuity in docs/handoffs/.\n`;

export async function execute(options, dependencies = {}) {
  const exec = dependencies.exec || run;
  const home = dependencies.home || os.homedir();
  const root = await rootFor(options.repo || '.', exec);
  const recovery = await recover(root, !!options.dryRun || options.command === 'doctor');
  if (recovery && options.dryRun && options.command !== 'doctor') return { command: options.command, repo: root, dryRun: true, recoveryPending: true, next: 'Rerun without --dry-run to finish the validated interrupted transaction.' };
  const manifest = await readManifest(root);
  if (options.command === 'doctor') {
    const agents = options.agents || manifest?.agents || await detect(root, home, exec);
    const global = options.global || manifest?.scope === 'global';
    const expected = await bundleIdentity();
    const installations = await Promise.all(installedPaths(root, agents, global, home, dependencies.env || process.env).map(async item => {
      const fingerprint = await skillFingerprint(path.dirname(item.path));
      return { ...item, present: fingerprint !== null, fingerprint, matchesCurrentPackage: fingerprint === expected.fingerprint, matchesEnrollment: manifest?.installation?.fingerprint === fingerprint };
    }));
    const guidance = await Promise.all((manifest?.files || []).map(async file => ({ path: file.path, intact: (await managedRead(root, file.path))?.toString().includes(file.added) || false })));
    return { command: 'doctor', repo: root, recovery, enrolled: !!manifest, package: expected, installedVersion: manifest?.installation?.version || null, scope: global ? 'global' : 'project', installations, guidance, prerequisites: { node: Number(process.versions.node.split('.')[0]) > 22 || (Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) >= 20), git: exec('git', ['--version']).ok, gh: exec('gh', ['--version']).ok, githubAuthenticated: exec('gh', ['auth', 'status']).ok }, note: 'Skill files and guidance discovery do not establish execution inside an agent runtime.' };
  }
  if (options.command === 'detach') {
    if (!manifest) return { command: 'detach', repo: root, changed: false, recovery };
    const edits = [];
    for (const file of manifest.files) {
      const before = await managedRead(root, file.path);
      const body = before?.toString('utf8');
      if (before && !Buffer.from(body).equals(before)) throw new Error(`Guidance must be UTF-8: ${file.path}`);
      if (body === undefined || body.split(file.added).length !== 2) throw new Error(`Managed guidance drift: ${file.path}; reconcile before detach`);
      const remaining = body.replace(file.added, '');
      edits.push({ path: file.path, before, after: remaining === '' && !file.existed ? null : Buffer.from(remaining) });
    }
    edits.push({ path: MANIFEST, before: await managedRead(root, MANIFEST), after: null });
    if (!options.dryRun) await transaction(root, edits, dependencies.hooks);
    return { command: 'detach', repo: root, dryRun: !!options.dryRun, changes: edits.map(e => e.path), preserved: ['Project brief and handoffs', 'Installed skill copies'], recovery };
  }
  if (options.command !== 'setup') throw new Error(`Unsupported execution command: ${options.command}`);
  const agents = options.agents || manifest?.agents || await detect(root, home, exec);
  const global = options.global || manifest?.scope === 'global';
  if (manifest && (JSON.stringify([...agents].sort()) !== JSON.stringify([...manifest.agents].sort()) || global !== (manifest.scope === 'global') || (options.maintenance && manifest.authority !== 'maintenance'))) throw new Error('Enrollment options differ; detach managed guidance before enrolling with new options. Existing project decisions remain preserved.');
  const identity = await bundleIdentity();
  const edits = [];
  const files = [];
  const ignoreBefore = await managedRead(root, '.gitignore');
  const ignoreBody = ignoreBefore?.toString('utf8') || '';
  if (manifest) {
    const tracked = manifest.files.find(file => file.path === '.gitignore');
    if (!tracked || ignoreBody.split(tracked.added).length !== 2) throw new Error('Managed guidance drift: .gitignore');
    files.push(tracked);
  } else {
    if (ignoreBody.includes('# project-align:start') || ignoreBody.includes('# project-align:end')) throw new Error('Untracked Project Align .gitignore block; inspect before setup');
    if (ignoreBefore && !Buffer.from(ignoreBody).equals(ignoreBefore)) throw new Error('.gitignore must be UTF-8');
    const added = (ignoreBefore ? (ignoreBody.endsWith('\n') ? '\n' : '\n\n') : '') + IGNORE + '\n';
    files.push({ path: '.gitignore', added, existed: ignoreBefore !== null });
    edits.push({ path: '.gitignore', before: ignoreBefore, after: Buffer.concat([ignoreBefore || Buffer.alloc(0), Buffer.from(added)]) });
  }
  for (const agent of agents) {
    const relative = adapter[agent];
    const before = await managedRead(root, relative);
    const body = before?.toString('utf8') || '';
    if (before && !Buffer.from(body).equals(before)) throw new Error(`Guidance must be UTF-8: ${relative}`);
    if (manifest) {
      const tracked = manifest.files.find(file => file.path === relative);
      if (!tracked || body.split(tracked.added).length !== 2) throw new Error(`Managed guidance drift: ${relative}`);
      files.push(tracked);
    } else {
      if (body.includes(START) || body.includes(END)) throw new Error(`Untracked managed guidance in ${relative}; inspect it before setup`);
      if (agent === 'cursor' && before) throw new Error('Existing .cursor/rules/project-align.mdc is not managed by this enrollment; preserve it and choose another name before setup');
      const added = (before ? (body.endsWith('\n') ? '\n' : '\n\n') : (agent === 'cursor' ? cursorHeader : '')) + GUIDANCE + '\n';
      files.push({ path: relative, added, existed: before !== null });
      edits.push({ path: relative, before, after: Buffer.concat([before || Buffer.alloc(0), Buffer.from(added)]) });
    }
  }
  const brief = await managedRead(root, 'docs/project-alignment.md');
  if (!brief) edits.push({ path: 'docs/project-alignment.md', before: null, after: Buffer.from(initialBrief(!!options.maintenance)) });
  const nextManifest = manifest ? { ...manifest, installation: identity } : { version: 1, scope: global ? 'global' : 'project', agents, authority: options.maintenance ? 'maintenance' : 'assess', files, installation: identity };
  const manifestBefore = await managedRead(root, MANIFEST);
  const manifestAfter = Buffer.from(JSON.stringify(nextManifest, null, 2) + '\n');
  if (!equal(manifestBefore, manifestAfter)) edits.push({ path: MANIFEST, before: manifestBefore, after: manifestAfter });
  const installations = installedPaths(root, agents, global, home, dependencies.env || process.env);
  const result = { command: 'setup', repo: root, agents, scope: global ? 'global' : 'project', authority: manifest?.authority || (options.maintenance ? 'maintenance' : 'assess'), dryRun: !!options.dryRun, changes: edits.map(e => e.path), installations, recovery, note: brief && options.maintenance ? 'Existing project brief preserved; its authority remains authoritative.' : undefined };
  const fingerprints = new Map();
  for (const item of installations) {
    // Upstream --copy cleans destination directories; reject links and unrecognized edits first.
    const anchor = path.parse(item.path).root;
    await safePath(anchor, path.relative(anchor, item.path));
    const fingerprint = await skillFingerprint(path.dirname(item.path));
    if (fingerprint !== null && fingerprint !== identity.fingerprint && fingerprint !== manifest?.installation?.fingerprint) throw new Error(`Installed skill has unrecognized or local changes: ${item.path}. Preserve those changes before setup.`);
    fingerprints.set(item.path, fingerprint);
  }
  result.installNeeded = [...fingerprints.values()].some(fingerprint => fingerprint !== identity.fingerprint);
  if (options.dryRun) return result;
  const beforeApply = result.installNeeded ? async () => {
    for (const item of installations) if (await skillFingerprint(path.dirname(item.path)) !== fingerprints.get(item.path)) throw new Error(`Concurrent installed skill change: ${item.path}`);
    await (dependencies.install || installSkill)({ root, agents, global, exec });
    for (const item of installations) if (await skillFingerprint(path.dirname(item.path)) !== identity.fingerprint) throw new Error(`Skill installation was not verified: ${item.path}. Recovery journal retained.`);
    await dependencies.hooks?.beforeApply?.();
  } : dependencies.hooks?.beforeApply;
  await transaction(root, edits, { ...dependencies.hooks, beforeApply });
  return result;
}
