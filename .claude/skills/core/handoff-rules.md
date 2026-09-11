# Handoff rules

Canonical. How work passes between agents without passing a conversation.

The whole point: **a fresh agent, with no history, reads a manifest and a handoff
and continues the work.** If it cannot, the handoff has failed, regardless of how
much it says.

## 1. Two documents, two jobs

| Document | Written by | Answers | Lives in |
| --- | --- | --- | --- |
| Manifest | Coordinator, once, before the lane starts | What is this task, what may it touch, when is it done? | `.claude/manifests/<task-id>.md` |
| Handoff | Lane, rewritten before it stops | Where is the work now, and what is the very next action? | `.claude/handoffs/<task-id>.md` |

The manifest is a contract and changes only when the coordinator changes it. The
handoff is a **snapshot** and is rewritten in place - the lane overwrites it, it
does not append to it.

Templates: `.claude/coordinator/manifest-template.md`,
`.claude/coordinator/handoff-template.md`.

## 2. A handoff is a snapshot, not a transcript

Under 150 lines. If it is longer, it is carrying history that the next agent does
not need.

Never in a handoff:

- a pasted diff, or any part of one beyond a named path and line number;
- full command output or log files - name the failing line, not the log;
- the previous conversation, or old user messages;
- narrative about what was tried and abandoned, unless a future agent would
  otherwise try it again, in which case it is one line under `Risks`;
- restated architecture rules - link to the reference instead.

The test: delete any line that a fresh agent would not act on. What survives is
the handoff.

## 3. `Exact next action` is the field that matters

It must be performable without reconstructing anything. It names the file, the
change, and the command that proves it - and where a previous agent got it
wrong, it says what not to do.

Good:

```text
Change the export route declaration back to `/api/trace-export` in
modules/trace/server/src/transport/trace-export.rest.ts:41, then rerun only the
trace REST integration test. Do not update the test to accept the new route -
the route is the thing that regressed, not the test.
```

Bad, and all three of these have been written here before:

```text
Continue the conversion.
Fix the remaining type errors.
Pick up where the previous lane left off.
```

If the work is genuinely finished, `Exact next action` says what the coordinator
should verify, not "nothing".

## 4. Statuses

Exactly these seven. No others, no adverbs, no "mostly complete".

| Status | Means | Coordinator does |
| --- | --- | --- |
| `ready` | Manifest written, lane not started | Start the lane |
| `in_progress` | Lane is working | Nothing - wait for a checkpoint |
| `partial` | Budget reached, work is green but unfinished | Review and commit what landed, start a fresh lane from the handoff |
| `blocked` | Cannot proceed without a decision, a shared file, or another task | Resolve the blocker; the lane does not wait |
| `review` | Lane believes it is done and wants the diff read | Review, then commit or return it |
| `complete` | Reviewed, committed, checks passed | Close the task |
| `abandoned` | Task was wrong, superseded, or not worth finishing | Record why, close |

`partial` and `blocked` are the honest, expected endings. A lane that reports
`review` with failing checks, or `complete` without a commit, has misreported -
and misreporting is more expensive than any blocker, because the coordinator
stops checking.

## 5. Green means green

A lane writes `review` only when the checks its manifest names have actually
passed. If a check fails and the lane cannot fix it inside its budget, the status
is `partial` or `blocked` and `Current failure` carries the exact failing
assertion or error - one line, with the file and the test name.

Never edit a test to make it pass unless the manifest says the test is wrong.

## 6. Shared-file requests

A lane never edits a shared file. It writes, under `Shared-file requests`, the
exact change:

```text
apps/api/src/app-rest/api-rest.doors.ts
  add:  installApiTraceExport,   (after installApiTrace, line 34)

packages/architecture-enforcer/src/feature-shape-baseline.json
  drop: "trace|legacy-transport-runtime"
  drop: "trace|nested-transport"
```

Path, then the line to add or drop, and where. The coordinator applies it
verbatim. "The doors file needs updating" is not a request; it is a task for
somebody else.

## 7. Writing the handoff is part of the work, not after it

Budget for it. A lane that spends its last turn on one more edit and leaves no
handoff has destroyed the value of everything before it - the next agent starts
from the diff and guesses at intent, which is exactly the expensive path this
protocol exists to avoid.

Write the handoff when any of these happen, and stop:

- the task is done;
- a shared file is needed;
- a check fails in a way you cannot fix inside the budget;
- the budget is reached;
- the manifest turns out to be wrong.

## 8. The lane's closing summary

Separate from the handoff file, a lane ends its run with a fixed summary to its
caller. Same facts, seven headings, no prose around them:

```text
Status:                <one of the seven>
Files changed:         <paths, grouped by package>
Checks passed:         <command -> result>
Failures:              <none, or the exact failing line>
Wire differences:      <none, or each with its reason>
Shared-file requests:  <none, or path + exact lines>
Exact next action:     <one concrete action>
```

This is what the coordinator reads first. It reads the diff second, and only for
what the summary named.
