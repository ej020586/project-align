# Output contracts

Keep the return brief short enough to recognize the project immediately. Put expanded evidence and the full decision queue after it or in linked project artifacts. Use descriptive links; issue numbers alone are insufficient context. Templates specify information, not mandatory wording.

## Return brief

**You were working toward:** the accepted outcome and its source; otherwise explicitly unresolved.

**Since your last handoff:** changes that affect the outcome, unfinished work, or verification. State when a reliable comparison checkpoint is missing.

**Recommended next:** an action, decisive criterion, tradeoff, owner when known, and completion condition. Explain the relationship to the outcome.

**Other lenses:** compare objective progress, fastest useful delivery, and risk reduction. If all agree, say so once; otherwise identify the different actions and why they differ.

**Your decisions:** the highest-impact blockers, linked to the complete queue below or in a durable artifact. Say "none identified within the reviewed sources" when appropriate.

**Ready for an agent:** a prepared handoff or a link to one. A decision dependency can leave no implementation ready; still specify the next decision or investigation.

**Evidence and maintenance:** coverage, consequential uncertainty, changed/proposed/failed updates, and local-only records.

## Decision queue

For every identified blocking decision, supply:

- Stable project-local identifier, question, known owner, impact, and blocked work.
- Evidence and the precise uncertainty requiring judgment.
- Two or three credible options with practical tradeoffs and the work each unlocks. Use fewer only when no meaningful alternative exists; avoid filler choices.
- Recommended option and **one named criterion** that decides it; identify what would reverse the recommendation.
- Status: proposed, awaiting decision, accepted, superseded, or unresolved conflict. An accepted answer includes its actual source and date; the agent's recommendation does not count as acceptance.

Order by impact and dependencies, not by issue number or recency. Keep priority proposals distinct from human-approved ordering. Existing decision identifiers remain canonical.

## Execution handoff

```markdown
# [Action title]

Outcome: [what will be true]
Why now: [objective link and decisive criterion]
Owner: [known person/role, or unassigned]
Context and evidence: [named links and relevant checkout/branch]
Scope: [included change and necessary boundary]
Dependencies and authority: [accepted decisions, blockers, permitted actions]
Acceptance criteria: [observable completion conditions]
Validation: [checks plus deployment/live evidence if required]
First action: [specific entry point]
```

Prepare the prompt in full; the user should not need to rewrite it. Preserve any existing implementation authorization, but an alignment-only invocation does not dispatch implementation itself.

## Durable brief and task handoff

`docs/project-alignment.md` holds stable context: accepted objective and source, constraints, canonical planning/decision links, active-work links, enrollment maintenance authority, and recent handoff references. Unknowns stay explicit. Keep issue/PR details in their authoritative records.

Name a handoff with UTC date/time and a task slug, adding a collision-resistant suffix when needed. Store it under `docs/handoffs/`; use repo-relative links and remote URLs. A handoff records:

- Task identity, timestamp, checkout branch and commit, and related PR/issue links.
- Work actually completed, validation evidence, and material changes since the prior checkpoint.
- Accepted decisions with sources, pending questions, and remaining acceptance gates.
- Next executable action or deliberate pause with a revisit trigger.
- Uncommitted work relevant to continuation, external verification gaps, and publication status.

Preserve earlier task records. Never put raw transcripts, machine-specific absolute paths, credentials, or unrelated personal content into durable artifacts.
