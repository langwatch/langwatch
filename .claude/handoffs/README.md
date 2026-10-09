# .claude/handoffs/

Runtime state. One file per task, `<task-id>.md`, written by the lane working
that task and rewritten in place each time it stops.

Everything in here except this README is gitignored. A handoff is a working
snapshot between two agents, not a record - it is stale the moment the task moves
on, and a stale handoff in git history is something a future agent will read and
believe.

If something in a handoff matters beyond the task, it graduates: a decision to
`dev/docs/adr/`, a plan to `dev/docs/plans/`, a rule to
`.claude/skills/core/`.

## The shape

Template: `.claude/coordinator/handoff-template.md`.
Rules: `.claude/skills/core/handoff-rules.md`.

Thirteen sections, under 150 lines, no pasted diffs and no command output. The
field that matters is section 9, `Exact next action` - concrete enough for a
fresh agent to perform without reconstructing anything.

Status is one of exactly seven: `ready`, `in_progress`, `partial`, `blocked`,
`review`, `complete`, `abandoned`.
