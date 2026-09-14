# Release evidence

This file distinguishes script, package, runtime, and user-pilot evidence. Performance targets are not results.

## Local verification — 2026-09-14

- Node 26 on macOS: script/enrollment/package checks pass, including real Skills CLI installation and npm tarball installation into a fresh path containing spaces. The suite now contains 39 tests.
- Skills CLI 1.5.26 discovers the single self-contained skill. Package validation checks relative resource links, JavaScript syntax, and the publication file allowlist.
- Fixtures cover missing access, new-item deltas, unavailable inventory, local edits, live locks, interrupted writes, provider readback, duplicate prevention, durable closure evidence, and unsupported closure.
- Codex independent read-only behavioral pilot: approximately 65 seconds total; evidence collection reported 616 ms. It recovered a stale planning instruction, related work in another worktree, and incomplete live acceptance. No private project content is published here.
- The independent pilot was not a human-accepted return. User acceptance timing, baseline medians, and token usage were not measured.

## Distribution and runtime verification

- Cross-platform GitHub Actions matrix: all six macOS/Linux/Windows × Node 22/24 jobs passed at [d7e1aa1](https://github.com/ej020586/project-align/actions/runs/34898499325). The release candidate workflow repeats checks; see the latest exact-revision run before release.
- Claude Code and Cursor read-only runtime checks: both discovered and used the installed skill in a synthetic local project, preserved the assessment-only boundary, and produced grounded next actions. Initial elapsed times were approximately 86 and 35 seconds. Both over-escalated ordinary test-scope choices; the instructions were tightened to keep engineering choices within the existing interface with the agent. These checks do not establish automatic handoff execution.
- Installation from published GitHub source: passed using the real Skills CLI against `ej020586/project-align`, targeting Codex, Claude Code, and Cursor in a fresh clone at another absolute path. A separate read-only assessment used only that clone and public GitHub records, completed in 25 seconds (collector 504 ms), and correctly exposed absent continuity and unverified npm publication. This is not a human-accepted return.
- Live maintenance: a scoped update was verified on the private pilot project, followed by an unchanged rerun. Two public follow-up issues were created through the helper and read back; a lagging list response prompted direct identity reconciliation, with a regression test and a verified no-write rerun.
- Real global enrollment verified both canonical shared skill copies and all three runtimes' guidance. The pinned Skills CLI shares the global `.agents/skills` location for Codex and Cursor.
- Explicit handoff checks in Claude Code and Cursor saved separate local task handoffs and updated the brief while preserving the unverified acceptance gate, prior handoff, and product code. Claude completed in about 93 seconds; Cursor in 54 seconds. Cursor's shell/collector access was denied and it disclosed the limitation while using direct file reads. These are explicit invocation checks, not guarantees that every runtime automatically invokes handoff instructions.
- npm publication: blocked by unavailable npm authentication; the proposed scope has not been verified as owned by the publisher.
- Ten actual user-return sessions and the proposed 50% median-time improvement: not measured.

The npm tarball is locally installable and the release workflow uploads it to the versioned GitHub release. Installation from that URL is separate from the shorter registry command, which becomes available only after successful npm publication and registry readback. Remaining gates are tracked in [npm publication](https://github.com/ej020586/project-align/issues/1) and [real-return measurement](https://github.com/ej020586/project-align/issues/2).
