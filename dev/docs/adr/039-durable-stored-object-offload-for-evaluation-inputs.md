# ADR-039: durable stored-object offload for evaluation inputs

**Date:** 2026-07-10

**Status:** Proposed

**Relates to:** [ADR-022](./022-event-log-source-of-truth.md) (event_log as source of truth, transient S3 spool for trace payloads), [ADR-007](./007-event-sourcing-architecture.md) (event sourcing), [ADR-022 data-retention](./022-data-retention.md) (row TTL).

## Context

A single evaluator `inputs` object carries the full context an evaluation ran against: the conversation, RAG chunks, tool outputs. For some tenants one `inputs` value reached GB scale for a single run. That payload lands verbatim in two durable places:

- `event_log.EventPayload` for the `lw.evaluation.reported` / `lw.evaluation.completed` event, and
- `evaluation_runs.Inputs` (JSON-stringified) through the fold projection.

An `evaluation_runs` row that large made a background ClickHouse part merge impossible under the server memory cap: the merge has to materialize the heavy columns of every row in the part, and one GB-scale `Inputs` value blew past the ceiling. A prior write-time fix (on an unmerged branch) truncated `Inputs` at a fixed byte budget. Truncation protects the table but silently destroys evaluator input content, and it does nothing for the event in `event_log`, which stays unbounded.

The trace pipeline already solved a similar problem in ADR-022 with a preview-plus-pointer offload. The difference here is the durability target: ADR-022 keeps full content in `event_log` and uses S3 only as a transient spool for the edge -> command-queue leg, because for traces `event_log` is a safe home for the full payload. For evaluation inputs the goal is the opposite: bounding `event_log.EventPayload` itself is the point, so the full content must live in a durable object outside the event log, with only a bounded marker in the event and the row.

## Decision

Oversized evaluation inputs are offloaded to the existing content-addressed stored-objects service. The event payload and the ClickHouse row carry a bounded marker that references the durable object and includes a preview; reads at API boundaries resolve the marker back to the full inputs transparently.

Concretely:

- **Inline threshold `EVAL_INPUTS_INLINE_MAX_BYTES = 1 MiB`** (env `LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES`). Inputs serialized at or below it stay inline. Above it, the serialized inputs are written to the stored-objects service (`purpose = "evaluation_inputs"`, `ownerKind = "evaluation"`, `ownerId =` the evaluation id) and replaced by a marker.

- **Offload marker** is a valid JSON object so every existing `JSON.stringify(inputs)` / `JSON.parse(Inputs)` seam keeps working:

  ```json
  { "__lw_stored_object": { "id": "...", "sizeBytes": 0, "sha256": "...", "preview": "...", "truncatedPreview": true } }
  ```

  `preview` is the first 16 KiB of the serialized inputs; `truncatedPreview` says whether it is a prefix of a longer payload.

- **Hard ceiling `EVAL_INPUTS_HARD_CEILING_BYTES = 50 MiB`** (env `LANGWATCH_EVAL_INPUTS_HARD_CEILING_BYTES`). Above it the full payload is not moved to storage (a multi-GB PUT is itself a memory and latency hazard). The marker carries the preview only, with `ceilingExceeded: true`, `id: ""`, `sha256: null`, and a structured warning attributes the bound to the tenant and evaluation. The full content is not recoverable in this pathological case; this is accepted because it protects the platform and is observable.

- **Write-time wiring.** The offload runs inside `emitReported` in `executeEvaluation.command.ts`, before the event is built, so the stored-object PUT precedes the `event_log` append (matching the PUT-then-row ordering the stored-objects service uses internally). It is on by default (the SYSTEM feature flag `ops_evaluation_payload_offload_disabled` is the operator kill switch, flipped from /ops/feature-flags) and fail-open: any error from the PUT keeps the inputs inline and logs a warning, and an unreadable kill switch keeps the default (offload runs). When disabled, inputs flow inline and only the unconditional repository cap below bounds the row.

- **Belt-and-braces unconditional row cap.** `evaluation-run.clickhouse.repository.ts` caps the serialized `Inputs` at 8 MiB at write, replacing it with a valid-JSON `{ "__lw_truncated": { originalBytes, cap } }` marker, and caps `Details` / `Error` / `ErrorDetails` as plain text with an observable suffix. This runs on every write regardless of the flag or the writer, so a ClickHouse part is merge-safe even when the offload path is off, failed open, or bypassed by another writer. With offload on, `Inputs` arrives here already as a small marker, so the cap is a no-op.

- **Read resolution.** Markers are resolved only at API read boundaries, behind an optional dependency, mirroring the trace read path. The natural seam is `EvaluationService.getEvaluationInputs`, the lazy per-evaluation read the trace drawer already fetches through: it streams the durable object and returns the full inputs, so the caller cannot tell whether the inputs were inline or offloaded. Folds and reactors receive the raw marker and never dereference it, so the fat payload never re-inlines on a fold re-write.

- **Billing ledger.** The stored-objects table already records `size_bytes` per row, which is the offloaded byte ledger. `StoredObjectsService.getStorageUsageByProject` sums it per project (optionally per purpose) using the ReplacingMergeTree IN-tuple dedup pattern, and `stored_objects` is added to the ClickHouse storage-stats `MONITORED_TABLES`. Stripe metering is out of scope; the ledger and its aggregation are the deliverable.

## Rationale / Trade-offs

Offload beats truncation because it keeps the full evaluator input content, which is the whole value of storing inputs: a truncated input cannot be re-inspected or re-run. Reusing the stored-objects service means content-addressed dedup, per-tenant BYOC dataplane resolution, the project-delete cascade, and the `size_bytes` ledger all come for free, and there is one byte path to reason about rather than a new one.

Resolving only at read boundaries, never inside the fold, is the load-bearing constraint. The fold reads current state and re-upserts it; resolving a marker there would re-inline the fat payload into the next row write and defeat the entire mechanism. Keeping folds and reactors on the raw marker is what makes the bound durable across re-folds.

The unconditional repository cap is deliberately coarser than the offload (it truncates rather than preserving content). It is not the primary mechanism; it is the backstop that guarantees merge-safety independent of the flag and independent of which writer produced the row.

## Consequences

- `event_log.EventPayload` and `evaluation_runs.Inputs` stay bounded for oversized inputs; part merges no longer risk memory exhaustion from a single fat row.
- Reads through the lazy inputs seam are transparent; no frontend change is required, since the marker is resolved server-side.
- Offloaded bytes are attributable per tenant through `size_bytes`, surfaced by `getStorageUsageByProject` and the storage-stats collector.
- **Retention gotcha (accepted, with follow-up):** `stored_objects` has no TTL (its migration defines no `TTL` clause, and the no-retention invariant is pinned by a test). Offloaded evaluation inputs therefore outlive the `evaluation_runs` row TTL: the row expires on the retention schedule, but the durable object persists until the project is deleted (the stored-objects project-delete cascade removes it). This is accepted for now. Follow-up: a retention-aware sweep that deletes `purpose = "evaluation_inputs"` objects whose owning evaluation has aged out, so offloaded inputs honor the same retention window as the row.
- The hard-ceiling case loses full content for pathological (>50 MiB) inputs. This is observable via the structured warning and is a conscious trade against unbounded PUTs.

## References

- Feature spec: `specs/evaluations/evaluation-payload-offload.feature`
- Offload module: `langwatch/src/server/app-layer/evaluations/evaluation-inputs-offload.ts`
- Unconditional caps: `langwatch/src/server/app-layer/evaluations/evaluation-column-caps.ts`
- Related ADRs: ADR-022 (event_log source of truth / transient spool), ADR-007 (event sourcing).
