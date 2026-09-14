#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { command, repoRoot, githubIdentity, digest, atomicJson, optionalJson, parseArgs, isMain } from './io.mjs';

export function ghClient(identity, root, run = command) {
  const prefix = `repos/${identity}`;
  const api = async (endpoint, method = 'GET', body) => JSON.parse(await run('gh', ['api', `${prefix}/${endpoint}`, ...(method === 'GET' ? [] : ['--method', method, '--input', '-'])], root, body ? JSON.stringify(body) : undefined));
  const pages = async (endpoint) => JSON.parse(await run('gh', ['api', `${prefix}/${endpoint}`, '--paginate', '--slurp'], root)).flat();
  return {
    async read(number) {
      const [issue, comments, timeline] = await Promise.all([
        api(`issues/${number}`), pages(`issues/${number}/comments?per_page=100`), pages(`issues/${number}/timeline?per_page=100`),
      ]);
      if (issue.pull_request) throw new Error('This helper maintains issues, not pull requests.');
      const record = {
        number: issue.number, title: issue.title, body: issue.body ?? '', state: issue.state,
        labels: issue.labels.map(l => l.name).sort(), updatedAt: issue.updated_at,
        historyHash: digest({ comments, timeline }),
      };
      return { version: 1, repository: identity, url: issue.html_url, record, comments, timeline, coverage: 'complete-api-pages' };
    },
    labels: async () => (await pages('labels?per_page=100')).map(l => l.name),
    list: async () => (await pages('issues?state=all&per_page=100')).filter(i => !i.pull_request),
    update: (number, changes) => api(`issues/${number}`, 'PATCH', changes),
    create: (body) => api('issues', 'POST', body),
  };
}

const text = (v) => typeof v === 'string' && v.trim().length > 0;
const evidence = (values) => Array.isArray(values) && values.length > 0 && values.every(v => text(v.source) && text(v.claim));
const webSource = (value) => { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
export function validatePlan(plan) {
  if (plan?.version !== 1 || !text(plan.repository) || !Array.isArray(plan.operations) || !plan.operations.length) throw new Error('Expected version:1, repository, and a nonempty operations array.');
  const ids = new Set();
  for (const op of plan.operations) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(op.id ?? '') || ids.has(op.id)) throw new Error('Operation IDs must be unique stable identifiers.');
    ids.add(op.id);
    if (!text(op.reason) || !evidence(op.evidence)) throw new Error('Every operation needs a reason and source-backed evidence.');
    if (op.kind === 'update-issue') {
      if (!Number.isSafeInteger(op.number) || op.number < 1 || op.expected?.number !== op.number || !op.expected.historyHash || typeof op.expected.body !== 'string' || !['open', 'closed'].includes(op.expected.state)) throw new Error('An issue update requires the complete snapshot.record as expected.');
      const allowed = ['title', 'body', 'state', 'labels'];
      if (!op.changes || !Object.keys(op.changes).length || Object.keys(op.changes).some(k => !allowed.includes(k))) throw new Error('Only title, body, state, and existing labels may be updated.');
      for (const k of ['title', 'body']) if (k in op.changes && !text(op.changes[k])) throw new Error(`${k} must preserve meaningful content.`);
      if ('state' in op.changes && !['open', 'closed'].includes(op.changes.state)) throw new Error('State must be open or closed.');
      if (op.changes.state === 'closed') {
        const complete = op.completion;
        if (!Array.isArray(complete?.criteria) || !complete.criteria.length || !complete.criteria.every(c => text(c.criterion) && evidence(c.evidence)) || !Array.isArray(complete.unresolved) || complete.unresolved.length) throw new Error('Closure requires evidenced acceptance criteria and zero unresolved criteria. A merged PR alone is insufficient.');
        if (!complete.criteria.every(c => c.evidence.every(e => webSource(e.source)))) throw new Error('Closure criterion evidence requires HTTP(S) source links; the coordinator must verify that the linked evidence satisfies the criterion.');
      }
    } else if (op.kind === 'create-issue') {
      if (!text(op.title) || !text(op.body)) throw new Error('Creation requires title and body.');
    } else throw new Error('Unsupported operation kind.');
    const labels = op.kind === 'update-issue' ? op.changes.labels : op.labels;
    if (labels !== undefined && (!Array.isArray(labels) || !labels.every(text))) throw new Error('Labels must be a list of existing names.');
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const matches = (record, changes) => Object.entries(changes).every(([k, v]) => same(k === 'labels' ? [...record[k]].sort() : record[k], k === 'labels' ? [...v].sort() : v));
const inline = (value) => value.replace(/\s+/g, ' ').replace(/[\\`*_{}\[\]<>]/g, '\\$&');
const evidenceLine = (entry) => `${inline(entry.claim)} — ${webSource(entry.source) ? `[source](${new URL(entry.source).href.replace(/[()]/g, c => c === '(' ? '%28' : '%29')})` : inline(entry.source)}`;

export function effectiveChanges(op) {
  const changes = { ...op.changes };
  if (!changes.state || changes.state === op.expected.state) return changes;
  const marker = `<!-- project-align:maintenance:${op.id} -->`;
  const lines = [marker, `### Project Align maintenance: ${changes.state}`, '', `Reason: ${inline(op.reason)}`, '', 'Evidence:', ...op.evidence.map(e => `- ${evidenceLine(e)}`)];
  if (changes.state === 'closed') {
    lines.push('', 'Acceptance criteria:');
    for (const criterion of op.completion.criteria) lines.push(`- ${inline(criterion.criterion)}`, ...criterion.evidence.map(e => `  - ${evidenceLine(e)}`));
  }
  lines.push(`<!-- /project-align:maintenance:${op.id} -->`);
  const receipt = lines.join('\n'), body = changes.body ?? op.expected.body;
  if (body.includes(marker)) {
    if (!body.includes(receipt)) throw new Error(`Operation ${op.id} already has a different maintenance receipt; reconcile it before proceeding.`);
    return { ...changes, body };
  }
  return { ...changes, body: `${body}${body ? '\n\n' : ''}${receipt}` };
}

// Disk journal persists intent before a remote write. A retry reads the provider first.
// GitHub issue PATCH has no relied-upon compare-and-swap contract: readback detects
// divergence, but cannot eliminate a write racing between the last read and PATCH.
export async function applyPlan(plan, { client, dryRun = false, journal = { entries: {} }, persist = async () => {} }) {
  validatePlan(plan);
  journal.entries ??= {};
  const outcomes = [], labels = await client.labels();
  for (const op of plan.operations) {
    const hash = digest(op), previous = journal.entries[op.id];
    const attribution = { reason: op.reason, evidence: op.evidence, ...(op.completion ? { completion: op.completion } : {}) };
    if (previous && previous.hash !== hash) throw new Error(`Operation ${op.id} was already used for different intent; use a new ID.`);
    const requestedLabels = op.kind === 'update-issue' ? op.changes.labels : op.labels;
    if (requestedLabels?.some(l => !labels.includes(l))) throw new Error(`Operation ${op.id} requests a label that does not exist.`);
    if (op.kind === 'update-issue') {
      const changes = effectiveChanges(op);
      const latest = await client.read(op.number);
      if (matches(latest.record, changes)) {
        outcomes.push({ id: op.id, state: 'unchanged', number: op.number });
        if (!dryRun && previous?.state === 'pending') { journal.entries[op.id] = { ...previous, ...attribution, hash, state: 'verified', number: op.number }; await persist(journal); }
        continue;
      }
      if (!same(latest.record, op.expected)) throw new Error(`Issue ${op.number} changed since inspection; reconcile a fresh full snapshot.`);
      if (dryRun) { outcomes.push({ id: op.id, state: 'would-update', number: op.number, changes }); continue; }
      journal.entries[op.id] = { hash, state: 'pending', number: op.number, ...attribution }; await persist(journal);
      await client.update(op.number, changes);
      const readback = await client.read(op.number);
      if (!matches(readback.record, changes)) throw new Error(`Issue ${op.number} readback differs; inspect it before retrying.`);
      // Preserve attribution and closure rationale in a durable receipt, not a new comment on every run.
      journal.entries[op.id] = { ...journal.entries[op.id], state: 'verified' }; await persist(journal);
      outcomes.push({ id: op.id, state: 'updated', number: op.number, url: readback.url });
    } else {
      const marker = `<!-- project-align:operation:${op.id} -->`;
      const existing = await client.list();
      const found = existing.filter(i => (i.body ?? '').includes(marker));
      if (found.length > 1) throw new Error(`Multiple records contain operation ${op.id}; reconcile manually.`);
      const desired = { title: op.title, body: `${op.body}\n\n${marker}`, ...(op.labels ? { labels: op.labels } : {}) };
      if (found.length) {
        const verified = await client.read(found[0].number);
        if (!matches(verified.record, desired)) throw new Error(`Previously created operation ${op.id} now differs; reconcile before proceeding.`);
        outcomes.push({ id: op.id, state: 'unchanged', number: found[0].number });
        if (!dryRun && previous?.state === 'pending') { journal.entries[op.id] = { ...previous, ...attribution, hash, state: 'verified', number: found[0].number }; await persist(journal); }
        continue;
      }
      if (previous) throw new Error(`Operation ${op.id} has prior remote intent but no matching record; resolve the uncertain outcome before retrying.`);
      if (existing.some(i => i.title.trim().toLowerCase() === op.title.trim().toLowerCase())) throw new Error('An issue with this title already exists; inspect it instead of creating another.');
      if (dryRun) { outcomes.push({ id: op.id, state: 'would-create', title: op.title }); continue; }
      journal.entries[op.id] = { hash, state: 'pending', ...attribution }; await persist(journal);
      const created = await client.create(desired);
      const readback = await client.read(created.number);
      if (!matches(readback.record, desired)) throw new Error('Created issue readback differs; resolve the pending operation before retrying.');
      journal.entries[op.id] = { ...journal.entries[op.id], state: 'verified', number: created.number }; await persist(journal);
      outcomes.push({ id: op.id, state: 'created', number: created.number, url: readback.url });
    }
  }
  return { version: 1, repository: plan.repository, dryRun, outcomes };
}

export async function main(argv) {
  const mode = argv.shift();
  if (!['snapshot', 'apply'].includes(mode)) throw new Error('Usage: records.mjs snapshot --repo PATH --issue N --output FILE | apply --repo PATH --plan FILE [--dry-run] [--authorized]');
  const args = parseArgs(argv, mode === 'snapshot' ? { '--repo': 'string', '--issue': 'string', '--output': 'string' } : { '--repo': 'string', '--plan': 'string', '--dry-run': 'boolean', '--authorized': 'boolean' });
  const root = await repoRoot(args.repo), identity = await githubIdentity(root), client = ghClient(identity, root);
  if (mode === 'snapshot') {
    if (!/^[1-9]\d*$/.test(args.issue ?? '')) throw new Error('A positive --issue number is required.');
    const result = await client.read(+args.issue);
    if (args.output) await atomicJson(args.output, result); else console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!args.plan) throw new Error('--plan FILE is required.');
  const plan = JSON.parse(await fs.readFile(args.plan, 'utf8'));
  validatePlan(plan);
  if (plan.repository !== identity) throw new Error('Plan repository does not match the current origin.');
  if (!args['dry-run'] && !args.authorized) throw new Error('Pass --authorized only when maintenance is authorized by the user or enrolled project authority.');
  const common = path.resolve(root, await command('git', ['rev-parse', '--git-common-dir'], root));
  const stateDir = path.join(common, 'project-align'), journalFile = path.join(stateDir, 'records.json');
  if (args['dry-run']) { console.log(JSON.stringify(await applyPlan(plan, { client, dryRun: true, journal: await optionalJson(journalFile) ?? { entries: {} } }), null, 2)); return; }
  await fs.mkdir(stateDir, { recursive: true });
  let lock;
  try { lock = await fs.open(path.join(stateDir, 'records.lock'), 'wx'); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('Another maintenance run or interrupted lock exists. Verify no writer is active, inspect records.json, then remove records.lock.'); throw e; }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    const result = await applyPlan(plan, { client, journal: await optionalJson(journalFile) ?? { entries: {} }, persist: (v) => atomicJson(journalFile, v) });
    console.log(JSON.stringify(result, null, 2));
  } finally { await lock.close(); await fs.unlink(path.join(stateDir, 'records.lock')); }
}
if (await isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
