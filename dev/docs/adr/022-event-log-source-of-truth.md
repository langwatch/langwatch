# ADR-022: event_log as single source of truth · S3 as transient spool only

**Date:** 2026-05-28

**Status:** Proposed (issue [#4215](https://github.com/langwatch/langwatch/issues/4215))

**Supersedes:** [ADR-021](./021-lean-fold-cache.md) §"Decision" §1's *"edge offload to permanent S3"* mechanism. ADR-021's other rules survive — see [What survives from ADR-021](#what-survives-from-adr-021).

**Relates to:** [ADR-007](./007-event-sourcing-architecture.md) (event sourcing), [ADR-015](./015-projection-replay-coordination.md) (replay), [ADR-017](./017-gateway-trace-payload-capture.md) (gateway payload capture).

## Context

ADR-021 leans the fold cache by **offloading over-threshold field values to S3 permanently** at the edge. Implementation surfaced two design facts ADR-021 didn't account for:

1. **A 256 KB cap already exists** at `recordSpanCommand.ts:146` (`capOversizedAttributes`). Anything downstream of the command worker is already bounded today. The unbounded-payload problem is narrower than the ADR framed: it's the **edge → command queue** leg, where the full OTLP request rides through Redis as a BullMQ-style job payload before the cap fires.
2. **Commands go through a queue.** `commands.traces.recordSpan(data).send()` puts the full command payload into the global GroupQueueProcessor. The event isn't in `event_log` yet when `.send()` returns. Anything we want to lean MUST be leaned before `.send()`, because the queue stage is the Redis pressure point.

A direct sync write to ClickHouse via `event_log` (with `async_insert: 1, wait_for_async_insert: 1`, which langwatch already uses) is ~20–50 ms at p50 — **faster** than an S3 PUT (~50–150 ms). The "S3 is naturally sync-friendly" argument ADR-021 implicitly leaned on doesn't hold: CH inserts are equally sync-friendly here, with a cleaner durability story (event_log alone is replay-sufficient).

Search is also a real concern under ADR-021: `translateFreeText` does `ILIKE` on the `trace_summaries.ComputedInput/Output` preview column, so search becomes lossy past the preview boundary. The cleanest answer is "extend the preview budget to cover a standard Claude response," not "send users to a second backend."

## Decision

**`event_log` is the single durable source of truth. Full content lives there. S3 is reduced to a transient spool used only for oversize protection of the command queue.**

Concretely:

- **`COMMAND_INLINE_THRESHOLD = 256 KB`** — matches the existing `capOversizedAttributes` boundary. Spans whose serialized command payload exceeds this are spooled to S3 at the edge, with the command carrying `{spoolRef}` only.
- **`IO_PREVIEW_BYTES = 64 KB`** — preview budget for IO attributes (`langwatch.input`, `langwatch.output`, `gen_ai.input.messages`, `gen_ai.output.messages`, log-record `body`). Covers a complete chat-style Claude completion at the common `max_tokens=8192` setting (~16K tokens × 4 chars/token ≈ 64 KB), and most longer-form completions up to ~16K tokens. Configurable via `LANGWATCH_IO_PREVIEW_BYTES`. **Sized to a "standard Claude response length"** — search hits the preview, and the preview is wide enough to be lossless for the modal case.
- **Edge handles oversize protection only.** No per-attribute offload at the edge anymore. Size-check the whole serialized command payload; spool the entire span if it crosses the threshold; otherwise pass through inline.
- **Interposition derives lean shapes** at a single hook in `eventSourcingService.ts:242-251`, between `eventStore.storeEvents()` and `router.dispatch()`. `leanForProjection(event)` rewrites over-threshold IO attribute values to a preview + a server-set `langwatch.reserved.eventref.<attrKey>` pointer, leaves other attributes unchanged, and is a no-op for event types without heavy fields.
- **Projection queue carries the lean events.** Projections (`stored_spans`, `trace_summaries`, the fold cache, all reactors) see lean shapes. The fold cache stays bounded because the dispatch lean step bounded it; `RedisCachedFoldStore.toCacheable` continues to strip non-IO ephemera (`events[]`, `spanCosts`, accumulated `attributes`).
- **`event_log` row carries FULL content** in `EventPayload` (ZSTD(3) compressed; LLM text compresses 3–8×). Replay reads the full event from `event_log` and applies `leanForProjection(event)` **before** invoking `projection.apply(state, event)` — same utility, same shape, so live and replay produce byte-identical projection state.
- **Read paths:**
  - List / search / detail-collapsed → projections (preview, fast, `ILIKE`).
  - "Show full" / online eval → CH SELECT on `event_log` by `(TenantId, AggregateType, AggregateId, EventId)` (sort-keyed + bloom-filtered → microseconds), parse `EventPayload`, extract the field. `TenantId` in the WHERE clause structurally blocks cross-tenant reads.
  - Replay (operational) → `event_log` rows → `leanForProjection` → projection apply.
- **`BlobStore`** stays as the swap-seam interface. `put` writes the transient S3 spool. `get({eventId, field})` reads the `event_log` row and extracts the field. `BlobStore.delete` is the cleanup hook called after `storeEvents` succeeds.

## Walkthrough

```
EDGE — OTLP collector
  receive OTLP request → for each span:
    compute serialized-command-payload bytes
    payload ≤ COMMAND_INLINE_THRESHOLD (256 KB)
      → regular RecordSpan command  (inline data in payload)
    payload > 256 KB:
      try S3 PUT (spool object, transient)
        success → oversized RecordSpan command  (carries {spoolRef} only)
        failure → fail-open: send regular RecordSpan command (full inline)
                  log warn ("oversize protection skipped; queue carries full payload")
  command.send() → COMMAND QUEUE (Redis GroupQueueProcessor)
  edge returns; durability lives at the queue stage, not event_log yet

COMMAND WORKER  (pulls from global queue)
  if regular:    use inline span data
  if oversized:  S3 GET(spoolRef) → reconstitute full span
  RecordSpanCommand.handle:
    stripReservedAttributes (defense; passthrough for langwatch.reserved.causality_depth)
    PII redaction · cost enrichment · token estimation
    construct SpanReceivedEvent with FULL content as data
  storeEvents → event_log INSERT (full content, ZSTD compressed)
  on success:
    if oversized → best-effort S3 DELETE(spool key)   (lifecycle policy = 24h safety net)
                                ↓
INTERPOSITION  (eventSourcingService.ts:242-251 — single hook)
  enrichedEvents = enrichedEvents.map(leanForProjection)
    leanForProjection(event):
      switch event.type:
        SpanReceived       → for each over-threshold IO attr
                             (langwatch.input/output, gen_ai.input/output.messages):
                               replace value with preview (≤ IO_PREVIEW_BYTES = 64 KB)
                               attach langwatch.reserved.eventref.<attrKey> = { field }
        LogRecordReceived  → if body > IO_PREVIEW_BYTES:
                               replace body with preview
                               attach langwatch.reserved.eventref.body = { field: "body" }
        other event types  → pass through unchanged
  router.dispatch(enrichedEvents)  → PROJECTION QUEUE (Redis)
                                ↓
PROJECTION WORKERS  (each pulls a lean event from its queue)
  fold projection      → trace_summaries  (preview as ComputedInput / ComputedOutput)
  map projection       → stored_spans     (lean SpanAttributes — preview + eventref)
  reactors             → eval triggers, broadcast, etc.  (same lean event)
  fold cache (Redis) write-through uses toCacheable to also strip non-IO ephemera
                     (events[], spanCosts, accumulated attributes for pathological many-span traces)

READS
  list / search / detail-collapsed
      ──▶ trace_summaries · stored_spans  (preview, fast, ILIKE on preview column)
  detail-expanded ("show full") · online eval
      ──▶ read langwatch.reserved.eventref.<attrKey> from stored_spans
          CH SELECT on event_log by (TenantId, AggregateType, AggregateId, EventId)
          → parse EventPayload JSON → extract <attrKey> field
          (slower, opt-in; CH point lookup with bloom + sort key = microseconds;
           TenantId in WHERE clause structurally blocks cross-tenant reads)
  replay (operational)
      ──▶ replayEventLoader reads event_log rows (full content)
          replayExecutor.apply: leanForProjection(event) → projection.apply(state, event)
          SAME utility as live → identical projection state

DURABILITY MAP
  event_log (CH)   = single source of truth · FULL content · replay-sufficient
  S3 spool         = transient oversize protection · gone after event_log INSERT succeeds
  projection tables= derived lean views · regenerable from event_log via replay

LEAN BOUNDARIES  (what stays small at each hop)
  Command queue (Redis)    ≤ 256 KB per job   (inline data or spoolRef — bounded by edge size-check,
                                                with fail-open fallback to full inline on S3 outage)
  event_log row (CH)       unbounded, ZSTD-compressed  (the only place full content lives)
  Projection queue (Redis) ≤ ~64 KB per IO attr        (bounded by interposition)
  Fold cache (Redis)       same as projection queue    (downstream of lean step + toCacheable)
  stored_spans / trace_summaries (CH)   ≤ ~64 KB per IO attr  (downstream of lean step)
```

## What survives from ADR-021

- **Reserved-namespace edge strip** (already at command worker via `RecordSpanCommand.stripReservedAttributes`, with `langwatch.reserved.causality_depth` passthrough).
- **Reserved-namespace exclusion from user-visible facet enumeration** (`buildSpanAttributeKeysFacetQuery` filters `langwatch.reserved.*`).
- **Differential preview budget** — IO attrs get the wide preview (now 64 KB), non-IO attrs stay at 2 KB.
- **`RedisCachedFoldStore.toCacheable`** as secondary defence for non-IO ephemera (`events[]`, `spanCosts`).
- **`BlobStore`** as the swap-seam interface. Backend changes; surface stays.

## What is rejected from ADR-021

- **Edge offload of every over-threshold field to permanent S3.** Replaced by edge oversize-spool + dispatch-time lean.
- **Manifest-shaped storage** (one S3 object per span carrying multiple fields). Replaced by `event_log` row, which is naturally the per-span manifest.
- **sha256-per-field integrity check** on `BlobStore.get`. ClickHouse's MergeTree parts manage row integrity; per-field hashes are redundant.
- **Project-prefix authorization** on `BlobStore.get`. Cross-tenant access is structurally blocked by `TenantId` in the WHERE clause of the `event_log` SELECT.
- **`BlobIntegrityError`** (deletable; CH handles integrity).

## Consequences

- `event_log` row size grows from leaned (~32 KB per IO attr) to full content (potentially MBs). CH handles this — `EventPayload` is `String CODEC(ZSTD(3))`, LLM text compresses 3–8×, MergeTree parts accommodate. Compaction works harder on bigger parts; monitor via existing CH metrics.
- Replay reads heavier rows. Acceptable since replays are operational/infrequent. Could be optimized later via CH column projection (load only the lean shape on replay).
- Each dispatch step adds a `leanForProjection` call. Single map over events array, microseconds, in the hot path of the command worker.
- The dispatch interposition is a structural change to `eventSourcingService.ts` that touches every pipeline downstream. Localized — one file, single hook — but worth a dedicated review pass.
- Read-time "show full" latency: CH point lookup with bloom + sort-key match — microseconds at p50, predictable p99 (better than S3 GET). One JSON parse + field extract per row.
- Operational footprint shrinks: S3 storage approaches zero (only transient spools, deleted on success). One less storage system to keep healthy in the user-facing path.
- **Replay durability invariant restored.** `event_log` alone is sufficient. No "event_log + S3 jointly are the source of truth" caveat.
- **The dispatch interposition runs unconditionally**, not gated by `release_trace_blob_offload`. It is a defensive content transformation: leaning is a no-op for sub-threshold IO (the modal case) and a safety-net lean for over-threshold IO regardless of flag. The flag gates the **user-visible** behavior (edge S3 spool + on-the-wire shape with the eventref attr); the interposition is server-internal and benefits projections + replay regardless. Rationale: gating the interposition would re-introduce the Redis clog risk for over-threshold IO when the flag is off, defeating the safety net.

## Rules

- `leanForProjection` is **the** single source of truth for the leaned shape. It is invoked at the dispatch interposition AND in `replayExecutor.apply` before invoking projection handlers. Any future place that consumes events for projection MUST go through it. Tests pin this invariant.
- `langwatch.reserved.*` is the server-internal namespace. Client-supplied attributes in that namespace MUST be dropped at the command worker (already enforced by `stripReservedAttributes`, with the `langwatch.reserved.causality_depth` passthrough for nlpgo loop detection). `leanForProjection` SETS the `langwatch.reserved.eventref.<attrKey>` attribute server-side after the strip.
- `langwatch.reserved.eventref.<attrKey>` carries `{ field: <attrKey> }` only — the `eventId` is implicit in the row carrying the eventref (it's the same span). `BlobStore.get` derives `(TenantId, AggregateType, AggregateId, EventId)` from the read context.
- S3 spool objects MUST be eagerly DELETEd after `storeEvents()` succeeds. Bucket MUST have a 24h lifecycle policy as a safety net for orphans (edge crash between PUT and command processing).
- On edge S3 PUT failure (oversize protection unavailable): **fail open** — send the regular RecordSpan command with full inline payload, log at `warn`. Ingestion is never blocked by oversize protection.
- Any user-visible enumeration of `stored_spans.SpanAttributes` keys MUST exclude `langwatch.reserved.*`. (Survived from ADR-021.)
- `event_log` retention drives the durability ceiling for "show full" reads. There is no longer a separate S3 retention to coordinate.

<!-- ci-trigger: force workflows to fire on this head -->
