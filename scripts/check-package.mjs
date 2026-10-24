import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.dependencies.skills !== '1.5.26' || pkg.scripts.postinstall || pkg.scripts.install || pkg.scripts.preinstall) throw Error('Unexpected installer dependency or installation hook');
const skillRoot = path.join(root, 'skills/project-align');
async function walk(dir) {
  const list = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Skill must be self-contained: ${file}`);
    if (entry.isDirectory()) list.push(...await walk(file));
    else list.push(file);
  }
  return list;
}
for (const file of await walk(skillRoot)) {
  if (file.endsWith('.mjs')) execFileSync(process.execPath, ['--check', file]);
  if (!file.endsWith('.md')) continue;
  const content = await fs.readFile(file, 'utf8');
  for (const [, target] of content.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), target.split('#')[0]);
    if (!resolved.startsWith(skillRoot + path.sep)) throw Error(`Non-portable skill link: ${target}`);
    await fs.access(resolved);
  }
}
const skill = await fs.readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
if (!/^---\r?\nname: project-align\r?\ndescription: /m.test(skill)) throw Error('Skill discovery frontmatter is missing');
const packResult = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }));
const packed = Array.isArray(packResult) ? packResult : Object.values(packResult);
for (const { path: name } of packed[0].files) {
  if (!/^(package\.json|README\.md|cli\/|skills\/project-align\/)/.test(name)) throw Error(`Unexpected published artifact: ${name}`);
}
console.log(`Validated self-contained skill and ${packed[0].files.length} publishable files.`);
