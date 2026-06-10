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
2. The fold is **unchanged** — it has no awareness of refs. Refs travel as reserved span attributes (`langwatch.reserved.blobref.*`) that the fold ignores; they survive into `stored_spans` because the spans projection writes the full attribute map.
3. `RedisCachedFoldStore.toCacheable` (additive, already landed) stays as a **secondary defence** to strip the still-growing small collections (`events[]`, `spanCosts`, accumulated `attributes`) for pathological many-span traces. It is not the primary mechanism.
4. Reads (`getTracesWithSpans` detail/eval) extract reserved blob-refs from each span, resolve them through `BlobStore.get`, and then **re-run `TraceIOExtractionService` against the resolved spans** to recompute trace-level `input`/`output` as full values. List / search use the inline preview from `trace_summaries.computedInput/Output` (no S3 fetch). **Returned bytes from the detail read are unchanged from the pre-feature shape.**

## Superseded approach (rejected)

An earlier draft of this ADR proposed refactoring `accumulateIO` onto presence-flags and splitting `computedInput/Output` into their own ReplacingMergeTree row written on winner-change. **Rejected** — edge offload makes the fold state lean for free, so that hot-path refactor (high blast radius on a versioned, replay-coordinated projection) is unnecessary. The clog is the *large single value*, which offload removes upstream; `computedOutput` never grew with span count (pick-winning), so there was never an O(N²)-in-IO problem to solve inside the fold.

### Trace-level read resolution: read-time recompute (chosen) over fold-carries-ref (rejected)

A second forking point arose during implementation: how does the detail/eval read get the **full** trace-level `input`/`output` when `trace_summaries.computedInput/Output` is now a preview (because the winning span was offloaded at the edge before the fold ran)?

- **(A) Fold-carries-ref** — the fold writes the winning span's blob ref into a new column on `trace_summaries`; read resolves trace IO via that column. **Rejected**: requires a fold change *and* a `trace_summaries` schema migration, reintroducing exactly the hot-path/replay blast radius this ADR otherwise avoids.
- **(B) Read-time recompute** — chosen. On read, after fetching the trace + its spans from CH, extract reserved blob-refs from each span, resolve them through `BlobStore.get`, then re-run `TraceIOExtractionService` against the resolved spans to recompute trace-level `input`/`output`. The same service that computes IO during the fold is **reused** from a second call site; the fold remains untouched; no schema change.

The trade-off is read-time cost: a per-trace recompute on detail/eval reads that touch offloaded data. Cheap relative to the S3 GETs and bounded by the span count of the trace being read. The reversibility wins: choice B is one PR's worth of code in the read path, with no schema or fold migration to roll back. Full decision record: `~/.claude/wisdom/2026-05-28-trace-blob-offload-read-resolution.md`.

## Consequences

- Redis entries bounded regardless of IO size; no O(N²) serialize; **no added CH reads in the fold loop** (IO is never read to fold — a "rehydrate IO from CH on cache-hit" alternative was rejected because it re-reads CH every fold, defeating the cache).
- The fold projection **code is unchanged** (it just receives preview-sized IO once offload is on) → the existing 170 trace-processing projection unit tests stay green; no behavior-preserving refactor to risk.
- **No projection version bump / replay** for the cache leanness — `trace_summaries` gains ref columns *additively*; the fold's computed values aren't recomputed differently.
- Edge offload is the single mechanism that shrinks **all** the large-IO copies (queue job, fold cache, event log, `stored_spans`, `trace_summaries`); the lean fold cache is one consequence, not a separate workstream.
- **Differential preview byte budget — 32 KB for IO attrs, 2 KB for everything else.** IO attributes (`langwatch.input`, `langwatch.output`, `gen_ai.input.messages`, `gen_ai.output.messages`) use a preview equal to the offload threshold (32 KB) so full-text search on `trace_summaries.ComputedInput/Output` is **lossless for sub-threshold values and covers the first 32 KB of offloaded ones**. Without this, `translateFreeText` does `ILIKE` against a 2 KB preview and silently returns zero rows for any search term past byte 2048. Fold-cache leanness is on a separate knob (`toCacheable`), so raising the IO preview does **not** reintroduce the Redis clog — the Redis entry and the CH write are independent.
- **One S3 object per span (manifest-shaped), not one per field.** Key shape `trace-blobs/{projectId}/{traceId}/{spanId}` holds a JSON manifest `{ version, encoding, fields: { attrKey: value, ... } }`. The blob ref carries a `field` selector + per-field `sha256`. A 3-5 over-threshold-field span costs **one** S3 PUT instead of 3-5, and read resolution coalesces N field refs from one span into **one** GET. Per-span (not per-trace) because OTLP spans are atomic — one ingest = one PUT, idempotent under retry; a per-trace shape would need cross-pod locking or LWW data loss because spans for one trace arrive across multiple ingest requests / pods over time. The bandwidth trade-off (a reader that only needs `langwatch.output` still pulls `langwatch.input`) is real but minor: over-threshold means already-large fields, most eval/detail reads consume both, and a msgpack+offset+Range-read encoding is a follow-up if it ever bites.
- **Server-internal namespace must not leak to users.** Attribute-key enumerations on user-visible surfaces (`buildSpanAttributeKeysFacetQuery`, `attributeFacetValues`, search autocomplete, NLP text-to-filter) filter out keys with the `langwatch.reserved.` prefix. `trace_summaries.Attributes` is not enumerated, so it doesn't need this filter — but `stored_spans.SpanAttributes` does.

## Rules

- `toCacheable` MUST preserve every field `apply` reads (reductions + winner pointers + presence flags).
- The IO write path MUST be idempotent under replay (keyed by `TraceId`, deduped by `UpdatedAt`).
- `langwatch.reserved.*` is the server-internal namespace. **Client-supplied attributes in this namespace MUST be dropped at the edge** (`offloadOtlpSpanAttributes`) before any other processing — they are not trusted input. The auth-boundary backstop in `BlobStore.get` (project-prefix check on `ref.key`) is defense in depth; the edge strip is the primary guard.
- Any user-visible enumeration of `stored_spans.SpanAttributes` keys MUST exclude `langwatch.reserved.*`.
