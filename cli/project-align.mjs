#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execute, parseArgs, PACKAGE_ROOT } from './enrollment.mjs';
try {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === '--version') console.log(JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version);
  else if (['help', '--help'].includes(options.command)) console.log(`Project Align\n\n  project-align setup [--repo PATH] [--agents codex claude-code cursor] [--global] [--maintenance] [--dry-run]\n  project-align doctor [--repo PATH] [--agents ...] [--global]\n  project-align detach [--repo PATH] [--dry-run]\n\nSetup installs the bundled skill and enrolls one Git repository. Default installation is project-local.\n--maintenance grants evidence-backed record maintenance; without it, assessment is read-only remotely.\nDetach preserves the brief, handoffs, and installed skills. Doctor never exposes authentication output.`);
  else console.log(JSON.stringify(await execute(options), null, 2));
} catch (error) {
  console.error(`Project Align: ${error.message}`);
  process.exitCode = 1;
}
