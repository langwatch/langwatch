# ADR-026: Per-trigger dispatch timing — cadence and trace-readiness debounce

**Date:** 2026-05-28 (debounce added 2026-06-01)

**Status:** Accepted

## Context

LangWatch triggers have four action types:

| Action | Semantics |
|---|---|
| `SEND_EMAIL` | Sends a customer-visible message to one or more recipients |
| `SEND_SLACK_MESSAGE` | Posts to a customer-configured Slack webhook |
| `ADD_TO_DATASET` | Writes one or more rows to a LangWatch-managed dataset |
| `ADD_TO_ANNOTATION_QUEUE` | Inserts items into a LangWatch-managed annotation queue |

Today's per-(trigger, trace) dedup via `TriggerSent` prevents the *same* trace from firing the trigger more than once. The dispatch pipeline has two distinct timing problems on top of that:

### Problem 1 — notification storms (cadence)

**N distinct traces matching the same trigger in a short window.** The pain is action-class dependent:

- 1000 distinct matching traces in 5 minutes = **1000 Slack messages** (notification storm; customer churn risk; #monitoring channel becomes unusable).
- 1000 distinct matching traces in 5 minutes = **1000 dataset rows** — which is often the *intent* (e.g., "capture every production trace where the user thumbs-down for an evaluation set").

The two action classes behave differently:

- **Notify**: each invocation lands in front of a human. Many invocations in a short window is a usability problem.
- **Persist**: each invocation writes durable data the customer asked for. Many invocations is a feature.

The trigger dispatch path needs to distinguish them. It currently does not.

### Problem 2 — half-formed dispatch (trace-readiness debounce)

A trace in LangWatch is assembled from many spans that arrive over time — the root span first, internal LLM and tool spans next, evaluation spans last, sometimes seconds or minutes apart. We **do not have a terminal signal** ("this trace is now complete"). Adopting an explicit terminal signal is a separate, larger change — out of scope for this ADR.

Today the two trigger reactors (`alertTrigger` on the trace pipeline, `evaluationAlertTrigger` on the evaluation pipeline) fire on **every** event into their pipeline. They re-evaluate every active trigger's filters against the current fold state and, if they match, dispatch. This eager evaluation produces three classes of problem:

1. **Half-formed dispatch.** A trigger that filters on `output.matches: "refund granted"` will fire as soon as the first matching span is folded — even if the trace's *final* output (a span that arrives 10 seconds later) walks the refund back. The operator sees a notification for a state the trace never actually reached.
2. **Half-formed persist.** `ADD_TO_DATASET` snapshots the trace at dispatch time. The row written to the dataset is truncated relative to what an operator browsing the trace UI sees a minute later. The dataset diverges from the trace.
3. **Wasted re-evaluation.** A 50-span trace evaluates every active trigger ~50 times even though the verdict almost always stabilises on the last few spans. Cheap per-trigger but quadratic in the number of active triggers, and the early evaluations are by definition wrong-or-equal-to the final one.

The dedup hop on `TriggerSent` makes (2) and (3) survivable — once a trigger has fired for a (trigger, trace) pair, subsequent matches no-op. But "first match wins" is exactly the half-formed problem.

## Decision

Add **two timing knobs** to the `Trigger` row, both per-trigger and independently tunable, that sit at different points in the dispatch pipeline:

| Knob | When it fires | What it does |
|---|---|---|
| `traceDebounceMs` | Before filter evaluation | Wait for the trace to settle so the filter sees the final state |
| `notificationCadence` | After dispatch decision | Batch matches inside a wall-clock window into one digest |

Both knobs ride the ADR-025 outbox queue: `traceDebounceMs` drives the `stage: "settle"` dedup TTL; `notificationCadence` drives the `stage: "cadence"` delay snapping.

### Action classification (the contract `notificationCadence` rides on)

Add two constant sets in `src/automations/cadences.ts` (shared between server dispatch and the UI):

```ts
export const NOTIFY_TRIGGER_ACTIONS = new Set<TriggerAction>([
  TriggerAction.SEND_EMAIL,
  TriggerAction.SEND_SLACK_MESSAGE,
]);

export const PERSIST_TRIGGER_ACTIONS = new Set<TriggerAction>([
  TriggerAction.ADD_TO_DATASET,
  TriggerAction.ADD_TO_ANNOTATION_QUEUE,
]);
```

The dispatcher routes on this classification at the top of its switch:

```ts
function computeScheduledFor(action, cadence, now) {
  if (PERSIST_TRIGGER_ACTIONS.has(action)) return now;        // immediate
  if (cadence === "immediate") return now;
  return new Date(now.getTime() + CADENCE_WINDOW_MS[cadence]);
}
```

### Schema — both knobs

Two new columns on `Trigger`:

```sql
ALTER TABLE "Trigger"
  ADD COLUMN "notificationCadence" TEXT NOT NULL DEFAULT 'immediate',
  ADD COLUMN "traceDebounceMs"     INTEGER NOT NULL DEFAULT 30000;
-- Cadence values: 'immediate' | '5min_digest' | '15min_digest' | 'hourly_digest'
-- Debounce values surfaced in the UI: 0 (off), 15000, 30000, 60000, 120000, 300000.
```

- `notificationCadence` is stored as TEXT (not an enum) so a future cadence value is a UI / dispatcher change with no DB migration.
- `traceDebounceMs` is stored as INTEGER ms (not an enum) so a future "10s" or "10min" addition is just a UI change.
- The cadence default is `immediate` for **existing** triggers (preserves current behavior — no surprise digest delays); new notify triggers default to `5min_digest` via app-layer logic.
- The debounce default is **30 seconds** for both existing and new triggers — see "Why default 30 seconds" below.

### Cadence is per-trigger, not per-(trigger, channel)

Customers who want different cadences for different destinations create multiple triggers with identical filters. This matches today's single-action-per-trigger data model. Per-(trigger, channel) cadence requires either a multi-action schema (large refactor) or per-recipient scheduling (asymmetric across actions). Per-trigger is congruent with today's data model and costs nothing extra.

### Cadence values

`immediate`, `5min_digest`, `15min_digest`, `hourly_digest` cover the meaningful operational regimes:

- `immediate`: alerts that need to wake on-call now.
- `5min_digest`: typical notification-storm protection without losing fresh signal.
- `15min_digest`: low-priority alerts where some batching is desired.
- `hourly_digest`: passive monitoring digests.

Daily and weekly digests aren't included in v1 — they cross the "is this still a trigger or is it a report?" line and complicate retention semantics for the underlying outbox rows.

### How the debounce rides the outbox queue

The debounce lives on the **unified outbox queue** (`langwatch:outbox`, ADR-025) as its `stage: "settle"` payload. There is no separate `langwatch:trigger-evaluation` queue.

The settle payload uses Debounce Mode keyed on `(projectId, triggerId, traceId)`:

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

The reactor's job collapses to **enqueue a settle payload** for every (active trigger × incoming event). It no longer evaluates filters or dispatches inline:

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
      traceDebounceMs: trigger.traceDebounceMs,
    },
    { deduplication: { ttlMs: trigger.traceDebounceMs } },
  );
}
```

The GroupQueue's Debounce Mode ensures:

- A re-fired event for the same (trigger, trace) replaces the pending request and **resets** the TTL — so an in-flight trace stays uncommitted as long as spans keep arriving.
- After `debounceMs` of silence, the dispatcher fires once with the latest payload — guaranteed exactly one evaluation per settled trace per trigger, regardless of how many spans the trace produced.
- The deduplication key is `(projectId, triggerId, traceId)` so two different triggers on the same trace settle independently with potentially different debounce windows.

When the settle process callback matches, it re-enqueues a `stage: "cadence"` payload with `delay = computeScheduledFor(trigger.action, trigger.notificationCadence, now) - now`. The same queue carries it; the audit row identified by `auditDedupKey` follows it through the cadence boundary.

### Where filter evaluation moves

`evaluateAndDispatchTrigger(req)` becomes the single owner of:

1. Re-reading the (now-settled) trace fold state.
2. Running `matchesTriggerFilters` / `matchesEvaluationFilters`.
3. Calling `triggers.claimSend(...)` for the ADR-025 at-most-once gate.
4. Calling `dispatchTriggerAction(...)` — which itself routes to the outbox or inline path based on action class.

The two reactors (`alertTrigger`, `evaluationAlertTrigger`) keep doing the pre-filter scan that decides *which* triggers are candidates for a given event (trace-only vs evaluation-required), but they no longer own the evaluation itself — they only emit enqueue requests.

### UI surface

Both knobs are surfaced in the staged authoring drawer (ADR-026):

- `notificationCadence`: dropdown, visible only when the action is in `NOTIFY_TRIGGER_ACTIONS`. Persist-action triggers don't see the field.
- `traceDebounceMs`: integer-seconds field with bounds `[0, 600]`, visible for every action class — persist triggers benefit even more than notify, because a dataset row captured before the trace settles diverges from the trace UI permanently.

Both fields collapse into a single "Cadence" stage on the drawer (the secondary drawer pattern from ADR-026). The current values appear on the automations settings list as columns so an operator scanning the list can see at a glance which triggers are trading latency for completeness.

## Rationale

### Why hardcoded action-class sets, not per-action runtime config

The four action types are stable (changes have to be coordinated across the codebase anyway). Hardcoded sets in one file are unambiguous and reviewable. Per-action runtime config (each action declaring its own dispatch class via metadata) adds indirection without benefit — there's no scenario where a single deployment would want different classifications for the same action.

### Why per-trigger cadence

Today's `Trigger` schema has one `action` field and one `actionParams` blob — fundamentally single-destination. Supporting per-(trigger, channel) cadence requires either multi-action triggers (a large refactor of every code path that reads `trigger.action`) or per-recipient scheduling (asymmetric for Slack vs email — leads to mismatched semantics).

Per-trigger cadence is congruent with today's data model and costs nothing extra. Customers who need per-channel cadence can duplicate triggers — workable as a fallback until someone files a real request.

### Why a per-trigger debounce, not a per-project default

Different triggers have different latency budgets. A pager-style "high latency on critical path" trigger wants 0ms debounce. A "capture for the eval dataset" trigger can afford 5 minutes. A single per-project default forces every team to compromise.

The trigger model already has a per-trigger `notificationCadence`; adding a sibling `traceDebounceMs` keeps the per-trigger configuration shape consistent.

### Why default 30 seconds for debounce, not 0 (and not 15)

`0` (no debounce) is current behavior, and current behavior is what the half-formed-dispatch problem looks like — picking it as the default ships the bug as the default. The default must be non-zero.

Between the two realistic candidates:

- **15s** is enough for the typical synchronous chat trace (root + one LLM call + maybe a tool call, all under 5s wall time) but cuts it close once you add a re-ranker, a synchronous evaluation step, or a tool that makes its own network call. A trace that legitimately takes 18s to assemble would dispatch from a partial fold.
- **30s** absorbs the common "agent with a few tool calls and a trailing evaluation" envelope while still landing well inside the latency operators tolerate for non-paging notifications.

30s wins as the default. 15s is offered as a first-class option so teams that have measured their P99 trace-completion latency can tighten up without a code change. Teams that need urgent (≤1s) notifications still flip the field to 0 explicitly — the visible setting in the drawer makes that trade-off legible at authoring time.

### Why GroupQueue Debounce Mode, not a new primitive

The deduplication-with-TTL pattern is already implemented in `src/server/event-sourcing/queues/queue.types.ts:DeduplicationConfig` and battle-tested by the projection-coalescing path. Reusing it means no new Redis key shape, no new Lua scripts, no new metrics surface — the existing `*:gq:*` keys cover it. The TTL-reset-on-overwrite semantics are exactly what "trace is still arriving" requires.

A bespoke per-trace "expected span count" or "OTel batch end" signal would be more accurate but significantly more invasive — it touches the ingestion path, the fold projection, and the SDK contract. Debounce is the cheapest first step that meaningfully reduces half-formed dispatch.

### Why both knobs ride one queue (stage-discriminated)

The earlier design used a separate `langwatch:trigger-evaluation` queue for settle. They were folded onto the one outbox queue on 2026-06-01 because the maintenance surface (Redis prefixes, metrics, deploy gates, audit adapter wiring) doubles with no behavior gain — a `stage:` field in the payload achieves the same separation with one queue. See ADR-025 for the queue design.

### Why these two knobs are independent

Two debounce-shaped knobs sit at different points in the pipeline:

| Knob | When it fires | What it does |
|---|---|---|
| `traceDebounceMs` | Before filter evaluation | Wait for trace to settle so the filter sees the final state |
| `notificationCadence` | After dispatch decision | Batch matches inside a wall-clock window into one digest |

A trigger configured `traceDebounceMs: 60000` + `notificationCadence: 5min_digest` means "wait 60s for the trace to settle, then if it matches, hold the notification for the next 5-minute digest boundary." Each knob solves a different operator pain — bundling them would force a worse default for at least one class of trigger.

### Why debounce applies to all action classes, not notify-only

`ADD_TO_DATASET` and `ADD_TO_ANNOTATION_QUEUE` rows are *more* sensitive to half-formed traces than notify actions — a truncated dataset row corrupts the customer's eval set in a way that is invisible until someone tries to use it. The cadence-vs-immediate split is notify-only because batching makes no sense for persist; debounce makes sense for both.

## Consequences

- **Two new `Trigger` columns.** Single `ALTER TABLE`s with defaults; instant on PG ≥ 11.
- **Existing triggers default to `immediate` cadence and 30s debounce.** Cadence preserves current behavior; debounce is a one-time change to the half-formed-dispatch default. Operators who were depending on eager evaluation see a one-time change — flip `traceDebounceMs` to 0 if needed. A migration banner / changelog notes both.
- **Operator default for new notify triggers is `5min_digest` cadence**, which is a behavior change vs today's implicit immediate. Existing triggers don't change.
- **Dispatcher rendering must handle `payloads[]`.** When `length === 1` (immediate or single-match digest), render as a single message; when `length > 1`, render as a digest with N occurrences. Templates (ADR-024) iterate `{% for m in matches %}` regardless of length.
- **Reactor shape changes.** `alertTrigger` / `evaluationAlertTrigger` no longer evaluate filters; they emit `outboxQueue.send({ stage: "settle", … })`. The unit tests for those reactors collapse to "the right number of enqueues for the right triggers" — the heavy filter-matching tests move onto the new `evaluateAndDispatchTrigger` function.
- **Worker-only.** The settle stage runs on the unified outbox queue, part of the outbox-adjacent worker stack. Web is unaffected.
- **The classification is the contract** for the outbox layer. `computeScheduledFor(action, cadence)` is the single function called by `.withOutbox`-registered reactors' `cadenceWindowMs` resolvers.
- **Future action types** (a hypothetical `SEND_WEBHOOK`, `OPEN_INCIDENT`) must be classified at the point of introduction. The two sets together must cover every `TriggerAction` enum value — enforced by a unit test that asserts the union has the same size as `allTriggerActions` and that every element is present.
- **Latency floor.** Operators who set 5min debounce + 1h digest cadence will see notifications up to ~65 minutes after the trace start. This is a deliberate trade-off — settings UI surfaces both numbers so the total budget is visible.
- **Memory pressure on the dedup index.** Each in-flight (trigger, trace) pair holds one Redis entry for `debounceMs`. At 5-minute debounce + 100K active traces × N triggers, the dedup-index size grows linearly. The existing GroupQueue ops dashboard (`gq:dedup-index:*`) already exposes this — wire an alert on the count, not just a hard cap.
- **Replay safety unchanged.** ADR-025's `TriggerSent` claim still gates the actual side effect, so a re-fired event after the debounce window (e.g. on a re-ingested trace) still no-ops if the dispatch already happened.
- **Multi-destination fan-out is a notify-side concern, not persist-side.** NOTIFY actions will eventually want one trigger → multiple destinations, potentially with different cadences each. Today's workaround is duplicating the trigger. PERSIST actions stay 1-destination by design. When fan-out lands, it lives on the notify path; no outbox-framework change required — the schema split (per-trigger row → notify-policy-with-channels) is the work.

## References

- [ADR-025](./022-transactional-outbox-for-stake-sensitive-dispatch.md) — outbox queue these knobs ride
- [ADR-024](./024-liquid-templates-for-trigger-notifications.md) — template engine that consumes the digest `matches[]` payload
- [ADR-026](./026-automation-operator-surfaces.md) — authoring drawer that exposes both fields
- `src/automations/cadences.ts` — where the constants live (shared client/server)
- `src/server/event-sourcing/pipelines/shared/triggerActionDispatch.ts` — `computeScheduledFor`
- `src/server/event-sourcing/queues/queue.types.ts` — `DeduplicationConfig` + Debounce Mode
- Prisma `Trigger` model — schema being extended
