# Project Align

Come back knowing what matters, what needs your judgment, and what can move now.

Project Align is a portable agent skill for Codex, Claude Code, and Cursor. It restores project context, proposes the next consequential move, and maintains evidence-backed handoffs. It is not a background service or an implementation agent.

## Install

Install just the self-contained skill with the standard [Skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add ej020586/project-align --skill project-align --agent codex claude-code cursor --global
```

Enroll a repository using the npm CLI **after the package is published**:

```sh
npx @ej020586/project-align setup --repo . --agents codex claude-code cursor --global --maintenance
```

Check [release evidence](https://github.com/ej020586/project-align/blob/main/docs/release-evidence.md) for the current publication and runtime validation status. A source release does not imply npm publication. Until npm is published, clone this repository, run `npm ci --ignore-scripts`, then use:

```sh
node cli/project-align.mjs setup --repo /path/to/project --agents codex claude-code cursor --global --maintenance
```

Requires Node.js >=22.20.0 and Git. GitHub-backed assessment and maintenance use authenticated `gh`; use `gh auth login` separately if needed. An installed, authenticated coding agent performs interpretation. No API key or model subscription is bundled.

Default skill installation is project-local; `--global` installs for your user but enrolls only the selected repository. `--maintenance` explicitly grants evidence-backed issue maintenance. Without that flag, remote work is assessment-only unless separately authorized by you. Setup itself never edits GitHub records or starts an agent. There are no npm installation hooks.

## Use

Invoke `$project-align` in Codex or `/project-align` in Claude Code/Cursor. Say `resume` (default), `handoff`, or `audit` with your project context. Enrollment also adds resume and handoff guidance to the selected runtimes; this is an instruction, not a guaranteed editor-open event.

The brief leads with:

- What you were working toward and what changed.
- One recommended next move, its decisive criterion, owner, and completion condition.
- Objective progress, fastest useful delivery, and risk reduction, consolidated when they agree.
- Your decision queue: credible options, tradeoffs, recommendations, and work unlocked.
- Ready-to-use agent handoffs and a receipt of verified record changes.

The coordinator works alone unless an independent intent, delivery, or backlog review can change the answer. Related task history is optional enrichment. Missing history or access is a coverage gap, not an empty queue. An unclear objective needs a decision; an inactive project can be parked with a revisit trigger.

## CLI

```sh
project-align setup --repo . --agents codex claude-code cursor --dry-run
project-align doctor --repo .
project-align detach --repo . --dry-run
project-align detach --repo .
```

`setup` uses the bundled skill through exactly `skills@1.5.26`, copies it to the selected runtimes, and verifies installed files before enrolling. It preserves existing guidance. `doctor` reports discovery, prerequisites, authority, and interrupted enrollment. `detach` removes only managed guidance; it preserves the brief, handoffs, and installed skill copies. Use `npx skills remove project-align` with your original scope and agent selection to remove the copies.

Run setup again from a newer Project Align release to update the installed skill. Review `--dry-run` first. Enrollment options are stable: detach before changing scope, agent selection, or authority. Existing project decisions and briefs survive reenrollment.

## Project records

- `docs/project-alignment.md` holds the accepted objective, constraints, authority, and links.
- `docs/handoffs/` holds separate task continuity, validation evidence, and the next action.
- `.project-align/enrollment.json` tracks relative managed guidance for repeatable setup/detach; it travels with the repo.
- GitHub remains authoritative for issue and PR records. Publish project documentation through the project's branch/PR workflow.

Installation never turns an inferred objective into an accepted decision. Maintenance preserves human priority ownership and existing taxonomies. Closure requires evidence for the actual acceptance criteria; merged code alone is insufficient for live-validation requirements.

Only the coordinator writes records. Full snapshots, changed-record checks, provider readback, stable creation markers, and a local write-ahead journal support safe retries. GitHub issue updates are not atomic compare-and-swap: another writer can race the final read. Divergent readback stops the run for reconciliation; this tool does not claim to eliminate that provider limitation.

Private transcript exports, credentials, unrelated chats, and machine caches do not belong in published handoffs or the skill package.

## Self-contained helpers

Run helpers relative to the installed skill directory:

```sh
node scripts/collect.mjs --repo /path/to/repo --offline
node scripts/collect.mjs --repo /path/to/repo --previous /private/prior.json --output /private/current.json
node scripts/records.mjs snapshot --repo /path/to/repo --issue 12 --output /private/issue.json
node scripts/records.mjs apply --repo /path/to/repo --plan /private/changes.json --dry-run
```

The collector reads Git metadata, indexes project brief/handoff paths, and inventories live GitHub work. It does not ingest raw private files, execute repository scripts, or inspect every issue in depth. Limits and unavailable sources are explicit. `--audit` increases inventory limits; `--since` also queries recently updated issues. Disappearance from an inventory requires individual verification.

Read the skill's [maintenance contract](skills/project-align/references/maintenance.md) before constructing a change plan. Remote writes additionally require `--authorized`, representing an actual user/enrollment grant. JSON shape validation does not establish that evidence proves a product outcome; that judgment remains the agent's responsibility.

## Development and release

```sh
npm ci --ignore-scripts
npm test
npm run check
npm pack --dry-run
```

CI tests on macOS, Linux, and Windows using Node 22 and 24. These checks exercise scripts and packaging; actual in-agent behavior is a separate gate. The release workflow requires a version tag matching `package.json`, repeats tests, packs from that commit, creates a GitHub release, and publishes the package when npm authentication is configured. It does not run the ten-return user pilot or infer its outcome.

The proposed pilot targets a first useful brief within 30 seconds, a partial update by 90 seconds when investigation continues, and a 50% reduction in median time to a user-accepted executable next step across ten real returns. These are experiment targets, not established performance claims. See [pilot instructions](skills/project-align/references/pilot.md).
