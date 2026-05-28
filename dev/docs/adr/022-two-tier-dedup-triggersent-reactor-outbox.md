# ADR-022: Two-tier dedup — `TriggerSent` as match-claim, `ReactorOutbox` as dispatch state

**Date:** 2026-05-28

**Status:** Accepted

## Context

The trigger dispatch path needs to answer two distinct questions:

1. **"Has this trigger matched this subject, ever?"** — the *match claim*. This is what stops the trace-processing reactor and the evaluation-processing reactor from both dispatching the same trigger when their pipelines race (the eval reactor wakes when an evaluation completes; the trace reactor wakes when the trace fold updates — both can fire for the same trigger/subject pair). The "subject" is a `traceId` for trace/evaluation triggers and a `customGraphId` for custom-graph alerts; `TriggerSent` stores the unused column as `NULL` (see `prisma/schema.prisma`'s `TriggerSent` model). Today this is `TriggerSent` with `@@unique([triggerId, traceId])` and `createMany skipDuplicates` returning `count: 1` to the winner — adequate for trace triggers, but Postgres treats `NULL` as distinct in unique constraints, so custom-graph alerts rely on the alert's `resolvedAt` lifecycle (one open row at a time) rather than a hard uniqueness constraint.
2. **"Has this match been dispatched? With what status, retry count, last error?"** — the *dispatch state*. Today this doesn't exist; dispatch is in-line and stateless.

[ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) introduces `ReactorOutbox` for question 2. There's an obvious temptation to merge them — keep one table for "this trigger has fired" — but the two semantics behave differently:

- `TriggerSent` is **domain** state, scoped to triggers, with the cross-pipeline race winner property baked in via the unique constraint.
- `ReactorOutbox` is **framework** state, scoped per-reactor (the table will hold rows for `customerIoTraceSync`, future auditable reactors etc. in Phase 7), with dispatch lifecycle columns (status, attemptCount, leasedUntil, lastError).

A separate decision is how `ReactorOutbox` rows relate to matches and to digest windows. Two competing shapes:

- **Row-per-match**: one outbox row per `(triggerId, subjectId)` where `subjectId` is `traceId` or `customGraphId`. Digest grouping happens at query time (`GROUP BY scheduledFor_bucket` in the worker's batch read).
- **Row-per-window**: one outbox row per `(triggerId, digestWindow)`, with a JSONB array of matches inside. Subsequent matches `UPDATE … SET payload = payload || new_match`.

Row-per-window seems compact but means 1000 simultaneous matches `UPDATE` the same hot row, serializing on a single PG lock. Row-per-match avoids the contention but creates more rows.

## Decision

Keep **two separate tables** with distinct roles:

- `TriggerSent` remains the **match-claim ledger**. Unchanged. Continues to serve as the cross-reactor race winner via its unique constraint.
- `ReactorOutbox` is the **dispatch-state table**. Row-per-match (one row per match-subject for trigger outbox reactors). Unique constraint is `(reactorName, dedupKey)` where:
  - Trace/evaluation triggers: `dedupKey = ${triggerId}:trace:${traceId}`.
  - Custom-graph alerts: `dedupKey = ${triggerId}:graph:${customGraphId}` (the subject is the graph, not a trace — alerts can re-fire across resolution cycles, so the dedupKey is scoped per claim, not lifetime).

  The `:trace:` / `:graph:` discriminator keeps the two subject types in separate namespaces so a future trigger type cannot collide.

Outbox row insertion is **gated on `TriggerSent` claim succeeding**: the reactor's match phase first calls `TriggerSent.claimSend`; only on a successful claim does it write the corresponding `ReactorOutbox` row.

Digest grouping is a **read-time concern**, not a write-time concern: when the outbox worker fires for a given trigger, it `SELECT … WHERE reactorName=X AND groupKey=Y AND status='queued' AND scheduledFor <= now()` (the indexed key defined in [ADR-023](./023-groupqueue-wakeup-pattern-for-outbox.md), with `groupKey = ${projectId}/${reactorName}:${triggerId}`) and batches whatever rows are returned into one dispatch call.

## Rationale

### Why not merge into one table

- `TriggerSent` is scoped to triggers. `ReactorOutbox` is the substrate for all future stake-sensitive reactors — `customerIoTraceSync`, anything else writing to an external system. Merging would conflate domain state with framework state, and the unique-constraint semantics differ (`TriggerSent` is cross-reactor by design; `ReactorOutbox` is per-reactor by design).
- A merged table would need the cross-reactor uniqueness of `TriggerSent` and the per-reactor lifecycle of `ReactorOutbox` in one schema. Possible but awkward, and it forces the framework's outbox to know about trigger-specific column semantics.

### Why row-per-match over row-per-window

- **PG contention.** Row-per-window with JSONB append serializes 1000 concurrent matches on one row. Row-per-match has no contention — each match inserts a fresh row, and `@@unique([reactorName, dedupKey])` makes the insert idempotent for replays.
- **Replay safety.** With row-per-match, a replay of the matching event re-attempts `createMany skipDuplicates` on the same `dedupKey` → no-op. With row-per-window, replay attempts an `INSERT ... ON CONFLICT DO UPDATE` that *appends* — possibly double-counting the trace.
- **Mirrors `TriggerSent`.** Both tables have the same per-match grain. Operator queries can join them on `(triggerId, traceId)` or `(triggerId, customGraphId)` depending on subject type. Mental model consistency.
- **Cost of more rows is negligible.** Outbox rows live ~minutes (until the worker drains the digest), then transition to `dispatched` and live ~30 days for audit, then prune. Even at 10k matches/day per project, the table is small.

### Why outbox insert is gated on `TriggerSent` claim

If we insert outbox rows unconditionally (without the `TriggerSent` claim gate), an out-of-order replay could insert a new `queued` outbox row for a `(triggerId, subjectId)` whose digest has already been dispatched. The drainer would happily re-notify.

Gating insertion on the `TriggerSent` claim means: if a match has already been claimed (by either the trace-reactor or the eval-reactor pipeline), no new outbox row is created. `TriggerSent` is the durable "we've already considered this match" anchor; `ReactorOutbox` is the durable "what's the dispatch's life-cycle state" anchor. Together they cover both the cross-reactor race and the replay safety.

## Consequences

- **Two unique constraints to maintain:** `TriggerSent.@@unique([triggerId, traceId])` (unchanged; effective for trace triggers, with custom-graph alerts deduped at the application level via the `resolvedAt` open-row lifecycle) and `ReactorOutbox.@@unique([reactorName, dedupKey])` (new; the `dedupKey` namespacing covers both subject types in one constraint).
- **Slightly more PG rows** than the row-per-window alternative would have produced. Trade-off is favorable — no hotspot, idempotent replay, simpler reasoning.
- **Digest worker does a small batch SELECT** on each wakeup. With `(reactorName, status, scheduledFor)` indexes this is sub-millisecond at expected volumes.
- **Operator queries can join `TriggerSent` and `ReactorOutbox`** on the appropriate subject column (`traceId` or `customGraphId`) — useful for the activity tab ("show me every match for this trigger and where it is in the dispatch lifecycle").
- **Migration**: `TriggerSent` schema unchanged. `ReactorOutbox` is a new table.

## References

- [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) — the outbox pattern this implements
- [ADR-023](./023-groupqueue-wakeup-pattern-for-outbox.md) — how the worker reads these rows
- ADR-019 — repository-service layering (`TriggerSentRepository` follows the same convention)
- PR #3528 — `TriggerSent` claim semantics this preserves
