# ADR-032: Persist-class actions ride the settle stage (trace-readiness debounce)

**Date:** 2026-06-19

**Status:** Accepted

**Supersedes:** the v1 inline-dispatch shortcut for persist-class actions described in ADR-026 (§"Half-formed persist") and ADR-030 (`alertTrigger` / `evaluationAlertTrigger` inline reactors).

## Context

ADR-026 §"Problem 2 — half-formed dispatch" identifies that `ADD_TO_DATASET` (and `ADD_TO_ANNOTATION_QUEUE`) snapshot the trace **at dispatch time**. If a trigger fires on the first matching event, the persisted row is truncated relative to the trace an operator browses a minute later — the dataset diverges from the trace. ADR-026 says `traceDebounceMs` exists to fix exactly this: *"wait for the trace to settle so the filter sees the final state"*, and that the knob *"drives the `stage: "settle"` dedup TTL"* on the ADR-030 outbox queue.

The v1 implementation wired this for **notify-class** actions (`SEND_EMAIL` / `SEND_SLACK_MESSAGE`) — they enqueue a settle payload, the trace settles over `traceDebounceMs`, then dispatch. But **persist-class** actions were kept on the **inline** path (`alertTrigger.reactor.ts`): filter-check against the current (possibly half-formed) fold → `claimSend` → `dispatchTriggerAction`, with the comment *"Persist actions don't pay the settle-stage re-read because the side effect is idempotent at the `TriggerSent` gate."*

That reasoning is incomplete. `TriggerSent` idempotency prevents a **second** dispatch for the same `(trigger, trace)` — but "first match wins" is *precisely* the half-formed problem ADR-026 line 44 calls out. Idempotency does not make the captured fold any more complete. So persist actions still capture truncated traces, defeating the very knob (`traceDebounceMs`) ADR-026 introduced for them — and persist is the case ADR-026 considers *more* sensitive (a corrupted dataset row, vs a slightly-stale notification).

## Decision

Route persist-class actions through the **same settle → cadence outbox path** as notify, so `traceDebounceMs` applies before the claim and the dispatch.

### Reactor

The persist branch of `alertTrigger.reactor.ts` / `evaluationAlertTrigger.reactor.ts` stops dispatching inline. For each active persist-class trigger × incoming event it **enqueues a settle payload** (the existing `.withOutbox` settle mechanism), keyed `(projectId, triggerId, traceId)` with the settle dedup TTL = `trigger.traceDebounceMs`. It no longer evaluates filters or calls `claimSend` / `dispatchTriggerAction` itself. This mirrors what the notify reactors already do.

### Settle stage

`handleSettle` no longer rejects non-notify actions. For a persist trigger, once the debounce window elapses it re-reads the **settled** fold, evaluates the trace filters against that complete state, and (on match) enqueues a **cadence** payload with an **immediate** schedule. Persist does not batch matches into a digest window — `computeScheduledFor` already returns `now` for persist actions — so the cadence is a same-tick hand-off, not a digest delay. The debounce lives entirely in the settle TTL.

### Cadence stage

`handleCadenceBatch` dispatches a persist trigger by reading the `TriggerSent` claim (`isSendClaimed`, the at-most-once gate) plus an in-batch dedup, re-reading the settled fold, calling `dispatchTriggerAction`, and writing `claimSend` **after** the dispatch succeeds — the same retry-safe ordering the notify path uses. Claiming *before* dispatch would let a retryable side-effect failure leave `claim = true`, so the outbox retry would see the row already-claimed and the dataset/annotation write would silently never land; claiming after success means a failed dispatch re-runs on retry. **The claim moves from the reactor to the cadence handler** — so at-most-once binds to the *settled* fold rather than the first half-formed one. Cross-pipeline races (trace pipeline vs evaluation pipeline both firing for the same `(trigger, trace)`) remain safe: the claim is still a single atomic `TriggerSent` insert, just relocated downstream, and persist side effects are row-idempotent (deterministic dataset entry ids / annotation upsert), so a retry re-runs only the unfinished matches.

The dispatcher gains the persist-dispatch dependencies it previously did not need (`traceById`, `addToDataset`, `addToAnnotationQueue`) so it can call `dispatchTriggerAction` from the cadence stage; these are injected the same way the notify deps are.

## Rationale

### Why route persist through the existing settle stage rather than a separate mechanism

The settle/cadence machinery (debounce TTL, fold re-read, audit projection, retry) already exists and is the canonical place trace-readiness debounce lives (ADR-026 + ADR-030). A parallel persist-only debounce path would duplicate all of it and drift. The cost is that `handleSettle` / `handleCadenceBatch` become action-class-aware — but they already branch on action (email vs Slack), so a persist branch is incremental, not novel.

### Why not a static reactor delay

The reactor framework's `delay` option is a single static value; `traceDebounceMs` is **per-trigger**. Only the settle dedup TTL captures the per-trigger debounce, so persist must ride settle to honour the configured value.

### Why move the claim to the cadence stage

Claiming in the reactor (v1) locks in the side effect against the *half-formed* fold — the exact failure mode. Claiming at cadence, after settle, ties at-most-once to the *settled* fold. The claim is written *after* a successful `dispatchTriggerAction`, not before — matching the notify path — so a transiently-failed dispatch re-runs on the outbox retry instead of being suppressed by an early claim; the pre-dispatch `isSendClaimed` read still provides at-most-once. The claim stays atomic; only its position moves.

## Consequences

- Persist actions capture the settled trace; `ADD_TO_DATASET` rows stop diverging from the trace UI. ADR-026's stated intent is finally honoured for persist.
- Persist dispatch now incurs the `traceDebounceMs` latency (default 30s) before the row is written. This is the intended trade — completeness over immediacy — and matches notify.
- `handleSettle` / `handleCadenceBatch` and the dispatcher deps are now shared by both action classes. The dispatcher is no longer notify-only.
- No schema change: persist reuses the existing `ReactorOutbox` settle/cadence payloads.
- Retry/dead-letter, audit projection, and the `${projectId}/` tenant prefix apply to persist for free, since it now rides the same queue.

## Test plan

- **Reactor unit** — a persist trigger enqueues a settle payload (TTL = `traceDebounceMs`) and does **not** `claimSend` / `dispatchTriggerAction` inline.
- **Dispatcher unit** — a persist settle payload re-reads the fold, matches filters, enqueues an immediate cadence; the cadence dispatches via `dispatchTriggerAction` then claims (retry-safe ordering); a no-match settle dispatches nothing; the claim is at-most-once across two settle/cadence runs for the same `(trigger, trace)`.
- **Integration** (`triggerDispatch.fullflow`) — the existing persist e2e (ADD_TO_DATASET / ADD_TO_ANNOTATION_QUEUE) now exercises the settle → cadence → `dispatchTriggerAction` path and still writes the real row. (Runs in CI.)
