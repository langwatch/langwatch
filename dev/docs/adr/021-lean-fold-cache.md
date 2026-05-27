# ADR-021: Lean Fold Cache — cache the read-set, persist the write-set

**Date:** 2026-05-27

**Status:** Proposed (issue [#4215](https://github.com/langwatch/langwatch/issues/4215))

**Relates to:** Departs from [ADR-007](./007-event-sourcing-architecture.md) ("fold state = stored data"); coordinates with [ADR-015](./015-projection-replay-coordination.md) (replay); enables the offload in #4215 (see also [ADR-017](./017-gateway-trace-payload-capture.md)).

## Context

`RedisCachedFoldStore` is a write-through cache in front of the ClickHouse-backed fold store (30s TTL, one key per aggregate). On every span event the **full** `TraceSummaryData` is `JSON.stringify`-ed into Redis. For large traces this state carries the accumulated `computedInput`/`computedOutput` text (plus `events[]`, `attributes`), so:

- **Redis memory clog** — the cached entry grows with the trace and is re-`SET` on every span.
- **~O(N²) CPU on the worker event loop** — `JSON.parse`(get) + `JSON.stringify`(store) of a growing state, N times for an N-span trace. No `worker_threads` anywhere → it blocks the single loop (head-of-line for all concurrent traces).

This is the verified root cause of the Redis pressure in #4215. ADR-007's principle *"Fold state = stored data. No intermediate types."* is precisely why the heavy IO rides in the cache: cached shape == stored shape == `apply`'s working shape.

Crucially, the fold's **decision** never needs the IO *text*: `accumulateIO` (`trace-io-accumulation.service.ts`) picks the winning span from scalars/flags (`outputSpanEndTimeMs`, `outputFromRootSpan`, `outputSource`, fallback flags) and a null-check on `computedInput`. The text is only *carried forward* to be written. Output is **carried, never combined**.

## Decision

**Cache the fold's read-set; persist the write-set.**

1. `RedisCachedFoldStore` gains an optional `toCacheable(state)` projection (additive, already landed) applied before the Redis `SET`. ClickHouse still receives the full state.
2. The trace-summary fold's `apply` must not require IO **text** to fold the next event. `accumulateIO`'s decisions are refactored to use explicit **presence flags** (`inputPresent`/`outputPresent`) + the existing winner scalars — not the carried text.
3. `computedInput`/`computedOutput` move to a **dedicated write path** (own ReplacingMergeTree row keyed by `TraceId`) written **only on winner-change** (when `apply` has the new text in hand). The hot summary row (cached + CH) carries scalars + presence flags + a bounded preview — never the IO text.
4. Reads (`trace_summaries` list + `getTracesWithSpans` detail/eval) resolve IO from the IO row; **returned bytes are unchanged**.

This deliberately departs from ADR-007's "fold state = stored data": the cached shape is a lean **projection** of the fold state (cached ≠ stored ≠ working). The departure is the whole point — it's what lets the hot loop stay small.

## Consequences

- Redis entries bounded regardless of IO size; no O(N²) serialize; **no added CH reads in the fold loop** (IO is never read to fold — a "rehydrate IO from CH on cache-hit" alternative was rejected because it re-reads CH every fold, defeating the cache).
- Fold projection **output values are unchanged** (same IO chosen) → the existing 170 trace-processing projection unit tests are the behavior-preserving safety net for the refactor.
- The persisted summary-row shape changes (IO columns move to their own row) → **projection version bump + replay per ADR-015**.
- Establishes the `{preview + ref}` reference shape reused by #4215's Track 2 per-field S3 offload.

## Rules

- `toCacheable` MUST preserve every field `apply` reads (reductions + winner pointers + presence flags).
- The IO write path MUST be idempotent under replay (keyed by `TraceId`, deduped by `UpdatedAt`).
