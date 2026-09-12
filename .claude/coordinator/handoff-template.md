# Handoff template

Copy to `.claude/handoffs/<task-id>.md` and fill in. Rewrite it in place each
time you stop - it is a snapshot, not a log. Under 150 lines.

The rules behind this shape are in `.claude/skills/core/handoff-rules.md`. Read
those once; this file is the form.

Delete the parenthesised guidance as you fill each section in. Write `none` where
a section is genuinely empty - an absent section reads as an unfinished handoff
and the coordinator will return it.

---

```markdown
# Handoff: <task-id>

Status: <ready | in_progress | partial | blocked | review | complete | abandoned>
Manifest: .claude/manifests/<task-id>.md
Updated: <YYYY-MM-DD HH:MM>

## 1. Identity

<Which task, which lane, which attempt. If this is a fresh lane continuing a
previous one, say so and name the attempt number - the coordinator uses it to
tell a stuck task from a large one.>

## 2. Objective

<One or two sentences, from the manifest. Not restated at length - the manifest
is authoritative and the next agent reads it.>

## 3. Owned paths

<Copied from the manifest. Everything else in the tree is read-only.>

## 4. Shared paths - do not edit

<Copied from the manifest. Changes to these go in section 10, never in the diff.>

## 5. Work completed

<What is actually done and green, as claims a reviewer can check. Not a
chronology.

  Good: "trace-export REST family declared and mounted; 6 routes answer on the
  same paths as origin/main."
  Bad:  "Worked on the trace module, made good progress on the REST side."

If nothing is done, write `none`. That is a legitimate handoff.>

## 6. Files changed

<Paths, grouped by package. Mark each added, modified or deleted. No diff.>

## 7. Checks completed

<Command -> result, one per line. Only checks that actually ran.

  pnpm --filter @langwatch/trace-server test:unit src/transport -> 24 passed
  pnpm typecheck:one modules/trace/server -> clean

A check you did not run is not listed. Do not write "should pass".>

## 8. Current failure

<The exact failing assertion or error: file, test name, one line of message. Not
the log. `none` if nothing is failing.>

## 9. Exact next action

<THE important field. Concrete enough to perform without reading anything else.
Name the file, the change, and the command that proves it. Where a previous
attempt went wrong, say what not to do.

If the work is complete, say what the coordinator should verify.>

## 10. Shared-file requests

<Exact lines for the coordinator to apply, per file:

  apps/api/src/app-rest/api-rest.doors.ts
    add: installApiTraceExport,   (after installApiTrace, line 34)

  packages/architecture-lint/src/feature-shape-baseline.json
    drop: "trace|nested-transport"

`none` if there are none.>

## 11. Risks

<What might be wrong that the checks would not catch. Wire differences belong
here with their reason. Things noticed but deliberately not fixed belong here,
one line each - not in the diff.>

## 12. Unfinished work

<Numbered. Each item small enough to be a next action. This is what the
coordinator turns into the next manifest, so vagueness here costs a whole
discovery pass later.>

## 13. Completion status

<One sentence: what a reviewer should conclude. If `review`, say which checks
back the claim. If `partial`, say what fraction of the objective landed and
whether what landed is independently committable.>
```
