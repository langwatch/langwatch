# ADR-030: Trace-readiness debounce for trigger evaluation

**Date:** 2026-06-01

**Status:** Proposed

## Context

A trace in LangWatch is assembled from many spans that arrive over time —
the root span first, internal LLM and tool spans next, evaluation spans
last, sometimes seconds or minutes apart. We **do not have a terminal
signal** ("this trace is now complete"): there is no end-of-trace event,
no per-trace "expected span count" we could compare against, and OTel
exporters do not flush at consistent times. Adopting an explicit
terminal signal is a separate, larger change — out of scope for this ADR.

Today the two trigger reactors (`alertTrigger` on the trace pipeline,
`evaluationAlertTrigger` on the evaluation pipeline) fire on **every**
event into their pipeline. They re-evaluate every active trigger's
filters against the current fold state and, if they match, dispatch.
This eager evaluation produces three classes of problem:

1. **Half-formed dispatch.** A trigger that filters on
   `output.matches: "refund granted"` will fire as soon as the first
   matching span is folded — even if the trace's *final* output (a span
   that arrives 10 seconds later) walks the refund back. The operator
   sees a notification for a state the trace never actually reached.
2. **Half-formed persist.** `ADD_TO_DATASET` snapshots the trace at
   dispatch time. Today the row written to the dataset is truncated
   relative to what an operator browsing the trace UI sees a minute
   later. The dataset diverges from the trace.
3. **Wasted re-evaluation.** A 50-span trace evaluates every active
   trigger ~50 times even though the verdict almost always stabilises
   on the last few spans. Cheap per-trigger but quadratic in the number
   of active triggers, and the early evaluations are by definition
   wrong-or-equal-to the final one.

The dedup hop on `TriggerSent` makes (2) and (3) survivable — once a
trigger has fired for a (trigger, trace) pair, subsequent matches
no-op. But "first match wins" is exactly the half-formed problem.

[ADR-025](./025-notify-persistent-action-classification.md) added
cadence digest windows on the dispatch side: once a match fires,
matches inside the same cadence window coalesce into one digest. That
solves notification-storm pain but is **not** trace-readiness; the
first half-formed match still opens the window.

## Decision

Add a **per-trigger trace-readiness debounce** that gates trigger
evaluation: when a trace receives an event, the trigger does not
evaluate filters until `debounceMs` of silence has elapsed for that
(trigger, trace) pair. Implemented on the in-house `GroupQueue`'s
existing "Debounce Mode" deduplication primitive (`extend: true,
replace: true` in `DeduplicationConfig`).

### Schema

A new column on `Trigger`:

```sql
ALTER TABLE "Trigger"
  ADD COLUMN "traceDebounceMs" INTEGER NOT NULL DEFAULT 30000;
-- Allowed values surfaced in the UI: 0 (off), 15000, 30000, 60000, 120000, 300000.
```

Stored as an integer ms, not an enum, so a future "10s" or "10min" addition
is just a UI change. The value **must** be configurable per-trigger and
**must** default to a non-zero value — every existing trigger and every
new trigger starts with a real debounce window so the half-formed-dispatch
default goes away on day one.

**Default: 30 seconds.** Short enough that operators expecting
near-real-time still see notifications well inside the SLO most teams
quote for their LLM apps, long enough that the common "LLM trace with
retries plus an evaluation step" envelope is fully assembled before the
filter runs. The closest alternative considered was 15 seconds — viable
for chat-style traces that almost always finish under 10s, but cuts it
fine once you add a re-ranking step or a synchronous evaluation, so 30s
wins as the broadly-safe default and 15s is offered as a first-class
option for teams that have measured their P99 trace-completion latency
and want to tighten up.

The migration default of 30s is a behavior change for existing triggers
(they previously evaluated on every event). A migration banner /
changelog notes this and links to the trigger settings page so anyone
who wants today's eager behavior can flip the trigger to 0.

### Evaluation queue

The debounce lives on the **unified outbox queue** (`langwatch:outbox`,
ADR-023 revision) as its `stage: "settle"` payload. There is **not**
a separate `langwatch:trigger-evaluation` queue — folding both stages
onto one queue halves the operational surface (one Redis prefix, one
audit adapter, one Grafana panel, one consumer loop) without losing
the per-stage tuning: stage-specific group key, coalescing, and dedup
mode are driven by the payload discriminator. See ADR-023 for the
full queue definition.

The settle payload uses Debounce Mode keyed on
`(projectId, triggerId, traceId)`:

```ts
// Inside the unified outbox queue's deduplication.makeId resolver:
makeId: (payload) =>
  isSettle(payload)
    ? settleDedupId(payload)            // per-(trigger, trace)
    : `${payload.projectId}/cadence/${payload.auditDedupKey}`,
// extend: true, replace: true — Debounce Mode.
// ttlMs defaults to DEFAULT_TRACE_DEBOUNCE_MS, overridden per trigger
// via the per-send `deduplication.ttlMs` override.
```

The reactor's job collapses to **enqueue a settle payload** for every
(active trigger × incoming event). It no longer evaluates filters or
dispatches inline:

```ts
// inside alertTrigger / evaluationAlertTrigger:
for (const trigger of triggers) {
  await outboxQueue.send(
    {
      stage: "settle",
      projectId: tenantId,
      triggerId: trigger.id,
      traceId,
      reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
      auditDedupKey: auditDedupKey({ projectId: tenantId, triggerId: trigger.id, traceId }),
      foldSnapshotAtEnqueue: { computedInput, computedOutput },
    },
    { deduplication: { ttlMs: trigger.traceDebounceMs } },
  );
}
```

The GroupQueue's Debounce Mode ensures:

- A re-fired event for the same (trigger, trace) replaces the pending
  request and **resets** the TTL — so an in-flight trace stays
  uncommitted as long as spans keep arriving.
- After `debounceMs` of silence, the dispatcher fires once with the
  latest payload — guaranteed exactly one evaluation per settled trace
  per trigger, regardless of how many spans the trace produced.
- The deduplication key is `(projectId, triggerId, traceId)` so two
  different triggers on the same trace settle independently with
  potentially different debounce windows.

When the settle process callback matches, it re-enqueues a
`stage: "cadence"` payload with `delay = computeScheduledFor(
trigger.action, trigger.notificationCadence, now) - now`. The same
queue carries it; the audit row identified by `auditDedupKey` follows
it through the cadence boundary.

### Where filter evaluation moves

`evaluateAndDispatchTrigger(req)` becomes the single owner of:
1. Re-reading the (now-settled) trace fold state.
2. Running `matchesTriggerFilters` / `matchesEvaluationFilters`.
3. Calling `triggers.claimSend(...)` for the
   ADR-022 at-most-once gate.
4. Calling `dispatchTriggerAction(...)` — which itself routes to the
   ADR-025 outbox or inline path based on action class.

The two reactors (`alertTrigger`, `evaluationAlertTrigger`) keep doing
the pre-filter scan that decides *which* triggers are candidates for a
given event (trace-only vs evaluation-required), but they no longer
own the evaluation itself — they only emit enqueue requests.

### UI

`EvaluationDebounceField` on the staged authoring drawer
([ADR-028](./028-staged-automation-authoring-drawer.md)), rendered as
its own stage between Conditions and Configuration. Required field
(no "leave blank to inherit"), surfaced visibly so the latency
trade-off is part of the authoring conversation:

> **Wait for trace to settle**  
> Don't evaluate this automation until the trace has been quiet for…  
> ▢ Off (evaluate on every span)  
> ▢ 15 seconds  
> ▢ 30 seconds (default)  
> ▢ 1 minute  
> ▢ 2 minutes  
> ▢ 5 minutes

The stage is **visible for every action class** — persist triggers
benefit even more than notify, because a dataset row captured before
the trace settles diverges from the trace UI permanently. The current
value is also shown as a column on the automations settings list
([ADR-029](./029-automation-management-and-health-surface.md)) so an
operator scanning the list can see at a glance which triggers are
trading latency for completeness.

## Rationale

### Why GroupQueue Debounce Mode, not a new primitive

The deduplication-with-TTL pattern is already implemented in
`src/server/event-sourcing/queues/queue.types.ts:DeduplicationConfig`
and battle-tested by the projection-coalescing path. Reusing it
means:

- No new Redis key shape, no new Lua scripts, no new metrics surface
  for the ops dashboard — the existing `*:gq:*` keys cover it.
- The TTL-reset-on-overwrite semantics are exactly what
  "trace is still arriving" requires; we do not need to invent a
  custom "I saw a new span, please push the timer out" mechanic.
- The dispatcher latency for a settled trace is a single fastq tick,
  not a bespoke timer thread.

A bespoke per-trace "expected span count" or "OTel batch end"
signal would be more accurate but significantly more invasive —
it touches the ingestion path, the fold projection, and the SDK
contract. Debounce is the cheapest first step that meaningfully
reduces half-formed dispatch.

### Why a per-trigger setting, not a per-project default

Different triggers have different latency budgets. A pager-style
"high latency on critical path" trigger wants 0ms debounce. A
"capture for the eval dataset" trigger can afford 5 minutes. A
single per-project default forces every team to compromise.

The trigger model already has a per-trigger
`notificationCadence` ([ADR-025](./025-notify-persistent-action-classification.md));
adding a sibling field keeps the per-trigger configuration shape
consistent.

### Why default 30 seconds, not 0 (and not 15)

`0` (no debounce) is current behavior, and current behavior is what
the half-formed-dispatch problem looks like — picking it as the
default ships the bug as the default. The default must be non-zero.

Between the two realistic candidates:

- **15s** is enough for the typical synchronous chat trace (root +
  one LLM call + maybe a tool call, all under 5s wall time) but cuts
  it close once you add a re-ranker, a synchronous evaluation step,
  or a tool that makes its own network call. A trace that legitimately
  takes 18s to assemble would dispatch from a partial fold.
- **30s** absorbs the common "agent with a few tool calls and a
  trailing evaluation" envelope while still landing well inside the
  latency operators tolerate for non-paging notifications.

30s wins as the default. 15s is offered as a first-class option (not
hidden behind a custom-ms field) so teams that have measured their
P99 trace-completion latency and know it stays well under 15s can
tighten up without a code change. Teams that need urgent (≤ 1s)
notifications still flip the field to 0 explicitly — the visible
setting in the drawer makes that trade-off legible at authoring time.

### Why this is orthogonal to ADR-025 cadence

Two debounce-shaped knobs sit at different points in the pipeline:

| Knob | When it fires | What it does |
|---|---|---|
| ADR-030 `traceDebounceMs` | Before filter evaluation | Wait for trace to settle so the filter sees the final state |
| ADR-025 `notificationCadence` | After dispatch decision | Batch matches inside a wall-clock window into one digest |

A trigger configured `traceDebounceMs: 60000` +
`notificationCadence: 5min_digest` means "wait 60s for the trace to
settle, then if it matches, hold the notification for the next
5-minute digest boundary." Each knob solves a different operator
pain — bundling them would force a worse default for at least one
class of trigger.

### Why all action classes, not notify-only

`ADD_TO_DATASET` and `ADD_TO_ANNOTATION_QUEUE` rows are
*more* sensitive to half-formed traces than notify actions — a
truncated dataset row corrupts the customer's eval set in a way that
is invisible until someone tries to use it. The cadence-vs-immediate
split (ADR-025) is notify-only because batching makes no sense for
persist; debounce makes sense for both.

## Consequences

- **New `Trigger.traceDebounceMs` column.** Single `ALTER TABLE`
  with a default; instant on PG ≥ 11.
- **Existing triggers default to 30s.** Operators who were depending
  on eager evaluation see a one-time change — flip to 0 if needed.
  The drawer surfaces the value on the next edit.
- **Reactor shape changes.** `alertTrigger` /
  `evaluationAlertTrigger` no longer evaluate filters; they emit
  `outboxQueue.send({ stage: "settle", … })`. The unit tests for those
  reactors collapse to "the right number of enqueues for the right
  triggers" — the heavy filter-matching tests move onto the new
  `evaluateAndDispatchTrigger` function.
- **Worker-only.** The settle stage runs on the unified outbox queue, which is part of the
  outbox-adjacent worker stack
  ([feedback-outbox-worker-only](../../feedback-outbox-worker-only.md)),
  so web is unaffected.
- **Latency floor.** Operators who set 5min debounce + 1h digest
  cadence will see notifications up to ~65 minutes after the trace
  start. This is a deliberate trade-off — settings UI surfaces both
  numbers so the total budget is visible.
- **Memory pressure on the dedup index.** Each in-flight (trigger,
  trace) pair holds one Redis entry for `debounceMs`. At 5-minute
  debounce + 100K active traces × N triggers, the dedup-index size
  grows linearly. The existing GroupQueue ops dashboard
  (`gq:dedup-index:*`) already exposes this — wire an alert on the
  count, not just a hard cap.
- **Replay safety unchanged.** ADR-022's `TriggerSent` claim still
  gates the actual side effect, so a re-fired event after the
  debounce window (e.g. on a re-ingested trace) still no-ops if the
  dispatch already happened.

## References

- [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) — outbox layer the dispatch flows through
- [ADR-022](./022-two-tier-dedup-triggersent-reactor-outbox.md) — `TriggerSent` claim that gates side effects
- [ADR-023](./023-groupqueue-wakeup-pattern-for-outbox.md) — GroupQueue primitive
- [ADR-025](./025-notify-persistent-action-classification.md) — cadence digest, the *other* trigger-side debounce
- `src/server/event-sourcing/queues/queue.types.ts` — `DeduplicationConfig` + Debounce Mode
- `src/server/event-sourcing/queues/groupQueue/scripts.ts` — TTL-reset Lua underlying the dedup
