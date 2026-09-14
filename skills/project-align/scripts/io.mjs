import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
export const digest = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
export async function command(file, args, cwd, input) {
  // No shell, credential interpolation, or command stderr in returned records.
  if (input !== undefined) {
    return new Promise((resolve, reject) => {
      const child = execFile(file, args, { cwd, timeout: 25000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        if (error) reject(new Error(`${file} failed (${error.code ?? 'unknown'}); check installation, access, or connectivity.`));
        else resolve(stdout.trimEnd());
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  }
  try { return (await exec(file, args, { cwd, timeout: 25000, maxBuffer: 16 * 1024 * 1024, windowsHide: true })).stdout.trimEnd(); }
  catch (error) { throw new Error(`${file} failed (${error.code ?? 'unknown'}); check installation, access, or connectivity.`); }
}
export async function repoRoot(repo = '.') {
  return fs.realpath(await command('git', ['rev-parse', '--show-toplevel'], path.resolve(repo)));
}
export async function githubIdentity(root) {
  const remote = await command('git', ['remote', 'get-url', 'origin'], root);
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote);
  if (!match) throw new Error('A GitHub origin without embedded credentials is required; no remote writes were attempted.');
  return match[1];
}
export function parseArgs(argv, specification) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!(key in specification)) throw new Error(`Unknown argument: ${key}`);
    if (specification[key] === 'boolean') result[key.slice(2)] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      result[key.slice(2)] = value;
    }
  }
  return result;
}
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try { await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
export async function optionalJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
