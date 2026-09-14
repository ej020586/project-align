# Pilot evaluation

The primary metric is median elapsed time from invocation to a **user-accepted executable next step**. Executable means enough context, authority, scope, and acceptance criteria exist to proceed without reconstructing the request. A deliberate parking decision with a revisit trigger qualifies. A generated recommendation alone is not user acceptance.

## Record observations

Use ten real project-return sessions, with ordinary re-entry comparison observations from comparable projects and absence lengths. Explain the baseline method and differences; do not describe a convenience sample as a controlled experiment.

For each session record project pseudonym, baseline or Project Align, invocation/start time, first useful brief time, accepted-next-step time and acceptance source, source coverage, agent count, token usage if observable, and attempted/verified remote writes. Record absent acceptance or instrumentation as missing. Synthetic fixtures validate behavior but never count as real returns.

Keep measurements in a local or explicitly approved artifact. Preserve privacy by recording timing and evidence references rather than full conversations. Report the sample size, exclusions, missing values, and both medians. Compare only sessions with actual observations; disclose incomplete sessions rather than silently dropping them.

## Proposed gates

- At least 50% lower median time than ordinary re-entry across ten real Project Align returns, with a described comparable baseline.
- Zero unsupported accepted decisions recorded and zero incorrect issue closures.
- Zero remote mutations on unchanged reruns.
- First useful brief around 30 seconds when sources are available; an interim result by approximately 90 seconds when more investigation is needed.

These are product hypotheses and pilot targets. Report measured failures as well as successes; no runtime, operating system, live account, or performance claim is established by static checks alone.

## Useful scenarios

Pilot on a project with a stale planning instruction, work in separate worktrees, and a merged implementation with outstanding live acceptance. Then resume a fresh clone of a second project without the original chat or machine. Verify that source gaps change confidence and next steps, rather than producing invented continuity.

Fixtures should exercise missing access, stale checkpoints, concurrent edits, interrupted writes, duplicate creation, and unsupported closure. Keep live maintenance within the session or enrollment authority and verify each changed record. A failed safety gate blocks unattended expansion even if the timing metric improves.
