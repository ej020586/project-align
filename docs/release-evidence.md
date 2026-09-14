# Release evidence

This file distinguishes script, package, runtime, and user-pilot evidence. Performance targets are not results.

## Local verification — 2026-09-14

- Node 26 on macOS: 36 tests passed, including real Skills CLI installation and npm tarball installation into a fresh path containing spaces.
- Skills CLI 1.5.26 discovers the single self-contained skill. Package validation checks relative resource links, JavaScript syntax, and the publication file allowlist.
- Fixtures cover missing access, new-item deltas, unavailable inventory, local edits, live locks, interrupted writes, provider readback, duplicate prevention, durable closure evidence, and unsupported closure.
- Codex independent read-only behavioral pilot: approximately 65 seconds total; evidence collection reported 616 ms. It recovered a stale planning instruction, related work in another worktree, and incomplete live acceptance. No private project content is published here.
- The independent pilot was not a human-accepted return. User acceptance timing, baseline medians, and token usage were not measured.

## Remaining evidence

- Cross-platform GitHub Actions matrix: pending initial publication.
- Claude Code and Cursor read-only runtime checks: both discovered and used the installed skill in a synthetic local project, preserved the assessment-only boundary, and produced grounded next actions. Initial elapsed times were approximately 86 and 35 seconds. Both over-escalated ordinary test-scope choices; the instructions were tightened to keep engineering choices within the existing interface with the agent. These checks do not establish automatic handoff execution.
- Installation from published GitHub source: pending initial publication.
- npm publication: blocked by unavailable npm authentication; the proposed scope has not been verified as owned by the publisher.
- Ten actual user-return sessions and the proposed 50% median-time improvement: not measured.

The npm tarball is locally installable. The registry command becomes available only after successful publication and registry readback.
