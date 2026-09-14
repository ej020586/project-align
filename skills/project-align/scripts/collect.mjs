#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { command, repoRoot, githubIdentity, parseArgs, atomicJson, optionalJson, digest } from './io.mjs';

export function compareSnapshots(previous, current) {
  if (!previous || previous.identity !== current.identity) return { baseline: 'missing-or-different-repository', changed: [], removed: [] };
  const changed = [], removed = [], unavailable = [];
  for (const type of ['issues', 'prs']) {
    if (!Array.isArray(current.github?.[type]) || current.coverage?.some(c => c.source === type && c.state === 'possibly-truncated')) {
      unavailable.push(type); continue;
    }
    const before = new Map((previous.github?.[type] ?? []).map(v => [v.number, v]));
    for (const item of current.github?.[type] ?? []) {
      if (digest(before.get(item.number)) !== digest(item)) changed.push({ type, number: item.number, title: item.title, url: item.url });
      before.delete(item.number);
    }
    // Disappearance from an open inventory is not proof of closure or completion.
    for (const item of before.values()) removed.push({ type, number: item.number, meaning: 'no-longer-in-current-inventory; verify individually' });
  }
  return { baseline: previous.collectedAt, changed, removed, unavailable, headChanged: previous.local?.head !== current.local?.head };
}
export async function collect({ repo = '.', offline = false, audit = false, since, previous }, run = command) {
  const root = await repoRoot(repo);
  const started = Date.now(), coverage = [], local = {};
  const checks = {
    head: ['rev-parse', 'HEAD'], branch: ['branch', '--show-current'],
    status: ['status', '--short'], worktrees: ['worktree', 'list', '--porcelain'],
    recentCommits: ['log', '-8', '--format=%h %s'],
  };
  await Promise.all(Object.entries(checks).map(async ([name, args]) => {
    try { local[name] = await run('git', args, root); }
    catch { coverage.push({ source: name, state: 'unavailable' }); }
  }));
  let identity;
  try { identity = await githubIdentity(root); } catch { identity = `local:${root}`; }
  const records = [];
  for (const relative of ['docs/project-alignment.md', 'AGENTS.md', 'CLAUDE.md']) {
    try { const stat = await fs.lstat(path.join(root, relative)); if (stat.isFile()) records.push({ path: relative, modifiedAt: stat.mtime.toISOString() }); } catch {}
  }
  try {
    for (const file of await fs.readdir(path.join(root, 'docs/handoffs'), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.md')) {
        const stat = await fs.stat(path.join(root, 'docs/handoffs', file.name));
        records.push({ path: `docs/handoffs/${file.name}`, modifiedAt: stat.mtime.toISOString() });
      }
    }
  } catch {}
  const github = {};
  if (!offline && !identity.startsWith('local:')) {
    if (since && !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(since)) throw new Error('--since must be an ISO date or UTC timestamp.');
    const limit = audit ? '1000' : '200';
    const queries = {
      repository: ['repo', 'view', identity, '--json', 'nameWithOwner,defaultBranchRef,url'],
      issues: ['issue', 'list', '--repo', identity, '--state', 'open', '--limit', limit, '--json', 'number,title,url,updatedAt,labels,assignees,milestone'],
      prs: ['pr', 'list', '--repo', identity, '--state', 'open', '--limit', limit, '--json', 'number,title,url,updatedAt,headRefName,headRefOid,baseRefName,isDraft,reviewDecision,statusCheckRollup'],
    };
    if (since) queries.recentIssues = ['issue', 'list', '--repo', identity, '--state', 'all', '--search', `updated:>=${since}`, '--limit', limit, '--json', 'number,title,url,updatedAt,state'];
    await Promise.all(Object.entries(queries).map(async ([name, args]) => {
      try {
        github[name] = JSON.parse(await run('gh', args, root));
        coverage.push({ source: name, state: Array.isArray(github[name]) && github[name].length >= +limit ? 'possibly-truncated' : 'inventory-only', limit: Array.isArray(github[name]) ? +limit : undefined });
      } catch { coverage.push({ source: name, state: 'unavailable', next: 'Check gh authentication, repository access, and connectivity; do not infer an empty queue.' }); }
    }));
  } else coverage.push({ source: 'github', state: offline ? 'not-requested' : 'unsupported-origin' });
  coverage.push({ source: 'runtime-chat-history', state: 'not-collected', next: 'Use available runtime task tools only for related project context.' });
  coverage.push({ source: 'worktree-content', state: 'paths-only', next: 'Inspect relevant worktrees and their guidance before concluding work is absent.' });
  const result = { version: 1, root, identity, collectedAt: new Date().toISOString(), elapsedMs: Date.now() - started, local, records, github, coverage };
  if (previous) result.delta = compareSnapshots(await optionalJson(previous), result);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(await fs.realpath(process.argv[1])).href) {
  try {
    const args = parseArgs(process.argv.slice(2), { '--repo': 'string', '--offline': 'boolean', '--audit': 'boolean', '--since': 'string', '--previous': 'string', '--output': 'string' });
    const result = await collect(args);
    if (args.output) await atomicJson(args.output, result);
    else console.log(JSON.stringify(result, null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
