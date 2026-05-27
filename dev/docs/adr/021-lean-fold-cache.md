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

**Lean the fold cache by leaning the data that flows into it — at the edge — not by refactoring the fold.**

The keystone is **edge offload** (#4215 Track 2): over-threshold field values are replaced with `{preview + ref}` at ingestion, *before* queue staging. By the time the fold runs, span IO is already small, so:

1. The fold's `computedInput`/`computedOutput` are **pick-winning** (one span's value, never concatenated — `shouldOverrideOutput` *overrides*), so post-offload they hold a **preview**, bounded by a single span ≤ threshold. The fold cache and the `trace_summaries` row are therefore **naturally lean** — no `accumulateIO` refactor, no IO-split table, no projection version bump for IO.
2. The fold additionally records the **winning span's blob ref** so trace-level full IO resolves on read.
3. `RedisCachedFoldStore.toCacheable` (additive, already landed) stays as a **secondary defence** to strip the still-growing small collections (`events[]`, `spanCosts`, accumulated `attributes`) for pathological many-span traces. It is not the primary mechanism.
4. Reads (`trace_summaries` list + `getTracesWithSpans` detail/eval) resolve refs → full IO; list/search use the inline preview. **Returned bytes are unchanged.**

## Superseded approach (rejected)

An earlier draft of this ADR proposed refactoring `accumulateIO` onto presence-flags and splitting `computedInput/Output` into their own ReplacingMergeTree row written on winner-change. **Rejected** — edge offload makes the fold state lean for free, so that hot-path refactor (high blast radius on a versioned, replay-coordinated projection) is unnecessary. The clog is the *large single value*, which offload removes upstream; `computedOutput` never grew with span count (pick-winning), so there was never an O(N²)-in-IO problem to solve inside the fold.

## Consequences

- Redis entries bounded regardless of IO size; no O(N²) serialize; **no added CH reads in the fold loop** (IO is never read to fold — a "rehydrate IO from CH on cache-hit" alternative was rejected because it re-reads CH every fold, defeating the cache).
- The fold projection **code is unchanged** (it just receives preview-sized IO once offload is on) → the existing 170 trace-processing projection unit tests stay green; no behavior-preserving refactor to risk.
- **No projection version bump / replay** for the cache leanness — `trace_summaries` gains ref columns *additively*; the fold's computed values aren't recomputed differently.
- Edge offload is the single mechanism that shrinks **all** the large-IO copies (queue job, fold cache, event log, `stored_spans`, `trace_summaries`); the lean fold cache is one consequence, not a separate workstream.

## Rules

- `toCacheable` MUST preserve every field `apply` reads (reductions + winner pointers + presence flags).
- The IO write path MUST be idempotent under replay (keyed by `TraceId`, deduped by `UpdatedAt`).
