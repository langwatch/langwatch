# ADR-091: The scheduler ops surface gains control, and a manual run is a first-class slot

**Date:** 2026-08-11

**Status:** Proposed

**Relates to:** [ADR-044](./044-scheduled-reports-automation-kind.md) (the schedule-triggered automation kind whose durable rows this surface controls), [ADR-052](./052-automations-on-process-manager-substrate.md) (revision-fenced durable wakes — the fencing this ADR reuses rather than reinvents), [ADR-090](./090-shared-ops-snapshot-single-writer.md) (the ops surface this lands beside).

Behavioural contract: [specs/ops/scheduler-operator-control.feature](../../../specs/ops/scheduler-operator-control.feature).

## Context

`/ops/scheduler` renders every durable `ScheduledJob` row: target, project, cron, next run, last fired, in-progress, retries, last error, active. It is deliberately read-only — `SchedulerOpsService`'s docblock states the constraint outright: an operator can see "what is scheduled, when it next fires, and when it last fired — **never a firing path**." That constraint is a code-level decision; ADR-044 introduced the scheduled-report kind but never ruled on operator control, so nothing is being overturned here so much as decided for the first time.

The page is nine columns wide and answers almost nothing an operator actually asks. Three failures, in ascending order of how much they cost during an incident.

**It cannot say the scheduler is behind.** `nextRunAt` in the past is the single most important fact this page could carry: it means the calendar loop is not keeping up, or has stopped. The page renders it as ordinary text — `formatWhen` produces `"8/11/2026, 1:12:40 PM (5m ago)"` for an overdue row and `"…(in 5m)"` for a healthy one, differing by two characters in the middle of a long string, sorted nowhere in particular. An operator has to read every row and mentally diff "in" against "ago". A scheduler that stopped firing an hour ago looks like a scheduler that is fine.

**It names things the operator cannot resolve.** Project is a raw ksuid. Target is a badge plus another raw ksuid. To learn which customer's weekly report is stuck, you copy an id and go look it up somewhere else.

**When something is stuck, it can only be watched.** `currentSlot` with rising `attempts` is a job failing and retrying; `currentSlot` that never clears is a slot claimed by a worker that died. The row shows both states honestly and offers nothing to do about either. The remedy today is a Postgres write by hand, which is the worst possible interface for an urgent, cross-tenant, customer-facing mutation.

The last one is what forces the decision. A read-only surface is only a discipline if the alternative it forbids is genuinely more dangerous; here the alternative is a hand-written `UPDATE` against a production table with no audit trail, no permission gate, and no idempotency, performed by whoever is awake.

What makes this delicate is not the mutation but the *fan-out*. One scheduler serves every project. A "run now" on a schedule-triggered report sends a real report to a real customer, and a careless one sends it twice.

## Decision

**The scheduler ops surface gains three controls — pause/resume, clear a stuck slot, and run now — gated on `ops:manage`, audited, and cross-tenant-explicit.** The page keeps its read-only default: every control is an explicit act, none is a side effect of viewing.

**A manual run is a first-class slot, not a bypass.** This is the load-bearing choice. "Run now" does not call the target's handler and does not claim the slot itself; it pulls the schedule's `nextRunAt` forward so the row becomes due, and the ordinary calendar loop claims and runs it. Three properties fall out, and they are exactly the ones a bypass would lose:

- A manual run **races safely** with the scheduled one. The scheduler's exactly-once guarantee is a *Postgres conditional-update lease* — `claim` updates `WHERE id = :id AND nextRunAt = :expectedNextRunAt`, so N workers racing one due row produce exactly one winner and no Redis lock is involved (ADR-044 §4; note this is NOT the process-manager revision fencing of ADR-052, which governs durable wakes). Making a row due hands it to that same mechanism, so a manual run and a cron tick landing together still fire once. The ops write is itself guarded on the same `nextRunAt` it read, so an operator acting on a row the loop already moved changes nothing and is told so.
- A manual run is **visible as a run**. It appears in `currentSlot`, it increments `attempts` on failure, it writes `lastError`, and it shows on the page as Running exactly like a scheduled one. An operator watching the page sees the effect of their own action in the same place they saw the problem.
- A manual run **cannot resurrect a retired schedule**. It reads the same `active` flag the loop reads; an inactive schedule refuses the run rather than firing once out of band.

**Run now fires the schedule's next slot, and nothing else.** There is no slot picker and no way to re-fire a slot that has already gone out. That is a deliberate narrowing: replaying a past slot is the one shape of this control that can deliver a customer the same artifact twice on purpose, and the mechanism chosen — moving `nextRunAt` — cannot express it anyway. An operator who genuinely needs a delivery repeated is better served by the product surface that owns it than by a scheduler override.

The confirm step names the target and the project **by name**, because the whole risk of this control is doing the right thing to the wrong tenant.

**Pause is the schedule's `active` flag, and it is honest about in-flight work.** Pausing sets `active = false`; it does not cancel a slot already claimed. The UI says so, because a pause that silently leaves a run in flight is how an operator concludes the pause did not work and starts pulling harder levers.

**Clearing a stuck slot is a repair, and is labelled as one.** It releases `currentSlot` so the schedule can be claimed again, and it is offered only when the slot has been held past the staleness threshold — not as a general-purpose "cancel". The confirm copy states the risk plainly: if the original worker is somehow alive, clearing lets a second worker claim the same slot. That is the trade the operator is making, and it is the right one when the alternative is a schedule wedged indefinitely.

**Every control writes an audit entry** — actor, action, schedule, slot, project, timestamp — and the page surfaces recent operator actions inline, so "why did this report send at 03:14" has an answer on the same screen.

**The page is re-cut around what it failed to say.** Read-only improvements, none of which need the controls:

```text
┌─ Scheduler ────────────────────────────── loop: healthy, last tick 3s ago ─┐
│  2 overdue      1 failing      14 due in the next hour      31 active      │
├────────────────────────────────────────────────────────────────────────────┤
│  [All] [Overdue] [Failing] [Paused]                          🔍 filter     │
├────────────────────────────────────────────────────────────────────────────┤
│ ⚠ Weekly usage report · Acme Corp      overdue 42m   0 3 21 * * ·  ⋯       │
│ ⚠ Cost digest · Globex                 retrying ×3   0 9 * * 1   ·  ⋯       │
│   Weekly usage report · Initech        in 12m        0 3 21 * * ·  ⋯       │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Overdue is a state, not arithmetic the reader performs.** `nextRunAt` in the past renders as its own status with the lateness beside it, and overdue rows sort to the top.
- **Loop liveness is a header fact.** If the calendar loop has not ticked recently, that is the headline, not a property of individual rows.
- **Names, not ksuids.** Project name and target name resolve server-side; ids move to a copy affordance.
- **Nine columns become five** — Target (name + kind), Schedule (cron + timezone, with the cron in words), Next run (relative, absolute on hover), Status (one column merging active / running / retrying / overdue / paused), and the row-actions menu. `In progress`, `Retries` and `Last error` collapse into Status and its tooltip, which is where they were readable anyway.
- Row actions follow [row-actions-overflow-menu](../best_practices/row-actions-overflow-menu.md); the table adopts `ListTable` per [list-table](../best_practices/list-table.md).

## Rationale / Trade-offs

**Why not keep it read-only.** The constraint was protecting against exactly one thing — an unaudited, unfenced firing path — and hand-editing Postgres is that thing with worse ergonomics. Making the path explicit, fenced, permissioned and audited is strictly safer than the status quo it replaces.

**Why "make it due" rather than "invoke the handler", or even "claim it here".** Invoking directly is a smaller change and a much worse primitive: it has no interaction with the calendar loop, so it double-sends under a race; it is invisible in `currentSlot`, so nothing on the page reflects it; and it would need its own retry, error and audit story rather than inheriting three that already exist.

Claiming the slot *inside the ops request* was the next candidate and was also rejected. The claim is only half the job — something then has to run the handler, settle the calendar and drive the retry ladder — and the code that does all of that lives in the worker loop. An ops request that claimed a slot would either have to execute customer-facing work inside a web request or leave the slot claimed and unworked until its lease expired. Moving `nextRunAt` instead is the smallest write that reaches the whole existing machine.

**Why run-now is gated behind naming the tenant.** Every other guard here is structural. This one is human: the failure mode is not a race, it is an operator acting on the row above the one they meant. Rendering the project name in the confirm — not the ksuid they cannot check — is the only guard that addresses it.

**What is accepted.** `ops:manage` holders can send a customer-facing artifact out of band; that is the point of the control, and the audit trail is what makes it accountable rather than untraceable. Clearing a stuck slot can, in the pathological case of a live-but-silent worker, admit a second worker to the same slot — bounded by the same fencing that governs the ordinary race, and strictly better than a permanently wedged schedule.

## Consequences

- An operator can answer "is the scheduler behind, and on what" from the header, and act on it in the same row — the two things the page could not do.
- The scheduler surface stops being read-only. `SchedulerOpsService`'s "never a firing path" docblock is replaced by a narrower and truer statement: no firing path that is unfenced, unaudited, or ungated.
- `ScheduledJobRepository` gains repair operations (set active, release slot, claim a slot with a manual reason). Routes call the service, never the repository, per [repository-service](../best_practices/repository-service.md); service methods are `getAll`/`getById`-style, repository methods `findAll`/`findById`.
- Manual runs are distinguishable from scheduled ones for the lifetime of the audit record, so a support question about an unexpected send is answerable without a log dive.
- Project and target name resolution adds a lookup to a page that previously read one table. It is an admin surface polling on an interval, not a hot path.
- New failure modes get named error codes and presentation-registry entries per [error-handling](../best_practices/error-handling.md): refusing to run an inactive schedule, refusing to clear a slot that is not stale, and losing the fencing race are all expected, actionable outcomes — not "unknown error".

## References

- Behavioural contract: [specs/ops/scheduler-operator-control.feature](../../../specs/ops/scheduler-operator-control.feature)
- Surface it lands beside: [ADR-090](./090-shared-ops-snapshot-single-writer.md), [specs/ops/ops-dashboard-density.feature](../../../specs/ops/ops-dashboard-density.feature)
- UI conventions: [dev/docs/best_practices/ops-dashboard.md](../best_practices/ops-dashboard.md)
