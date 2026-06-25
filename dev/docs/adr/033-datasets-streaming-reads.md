# ADR-033: Experiments run on the whole dataset via a paginated feed + pointer dispatch, with lean results-by-reference

**Date:** 2026-06-18
**Status:** Proposed

> **One-line:** Remove the **5 MB read cap** that silently truncates large datasets so experiments run on **every row** — feed the existing **per-row dispatch** from a **byte-budgeted paginated reader** (via `chunkOffsets`), keep dispatch **inline-by-default but stage-heavy-rows-by-size** (no bytes over the Lambda cap, no content sniffing), and store run results as a **lean shape** (light columns inline, heavy columns referenced by `projectId + datasetId + rowId`, resolved only for interactive display) — all behind a flag, building on **ADR-032** (chunk storage), **ADR-022** (durable-source + lean-reference precedent), and **#4910** (engine fetches attachment URLs).

## Context

ADR-032 moved dataset content to S3 JSONL chunks with a PG-authoritative per-chunk row-offset index (`chunkOffsets`) and explicitly **deferred reads**. Today `getFullDataset` caps every read at **5 MB** (`src/server/api/routers/datasetRecord.utils.ts`, default `limitMb=5`). So a customer can *upload* a 14 GB image dataset but a run silently executes only the first ~5 MB (≈0 complete image rows). #4910 (merged) made the Go engine fetch attachment URLs server-side and deliver them to the model. This ADR is the missing middle.

**Forcing function.** ADR-032 shipped the storage half; #4910 shipped the engine-fetch half. This is the only remaining gap blocking the multi-GB customer from running evals.

**Blast radius** is customer data and money — runs read/execute customer datasets, write results, and stored GB is billable. A wrong feed/dispatch/result model silently truncates, OOMs the worker, or double-stores GB. → explicit invariants with test anchors; this ADR was put through a mandatory red-team (folded as v2).

**What already works (verified).** The per-row execution model already exists for experiments-v3: `runOrchestrator` (`experiments-v3/execution/orchestrator.ts`) generates cells = rows × targets and fires **one Lambda invoke per (row × target) + one per (row × target × evaluator)**, concurrency 10 (a per-pod, per-run in-process semaphore). Dispatch already **stages by size**: `invokeLambda` (`optimization_studio/server/lambda/index.ts`) measures the serialized invoke envelope and, above `STUDIO_INVOKE_STAGING_THRESHOLD_BYTES` (~5 MiB, under the 6 MB Lambda cap), spools the body to S3 and sends a presigned-URL pointer; the Go side fetches it (`services/nlpgo/.../staged_payload.go`). The covering-chunk range read also already exists: `DatasetService.listRecords` (`dataset.service.ts`) resolves a row range via `chunkOffsets`.

**What does NOT exist yet (red-team, v2).** The stable row id is **dropped at the read boundary** — `dataLoader.ts` maps `r.entry` only, discarding `r.id`; the orchestrator's `datasetRows` is positional and `recordTargetResult` keys on `index` (run-row position, not dataset row). So the reference key this ADR depends on must be **threaded through the run path** — that is real plumbing, not an additive schema change.

**Prior art.**
- **ADR-032** — S3 JSONL chunks; `chunkOffsets` row-range index; `status` gating; `getFullDataset` read seam.
- **ADR-022 / PR #4216** — large trace IO: full content in a durable source (`event_log`), projections carry a **lean shape** (preview + server-set `langwatch.reserved.eventref` pointer), **size-gated**, resolved **TenantId-first**, behind a flag (off = byte-for-byte). Superseded **ADR-021's "permanent per-field S3 blob offload."** This ADR mirrors the pattern; the divergence is that our referenced source is **mutable** (see below).
- **#4910** — engine fetches `http(s)` attachment URLs → base64 in memory → model; stores nothing; size-cap + loud `attachment_fetch_error`.
- **ADR-019** + `CLAUDE.md` — route → service → repository; `projectId` on every query.

**Scope honesty.** v1 fixes the **experiments-v3 run engine** only. The Studio "Evaluate"/"Optimize"/workflow run engine (`loadDatasets` → one invoke, whole dataset inlined → Go accumulates all results, `services/nlpgo/app/engine/evaluation.go`) stays 5 MB-capped until a follow-up ADR. **Caveat (red-team):** Optimization Studio's *results panel* reuses the v3 result-display transform (`ResultsPanel.tsx` → `transformBatchEvaluationData`), so the lean-result **display** change reaches Studio even though its run engine does not — the shared reader must handle the lean shape.

## Decision

1. **Byte-budgeted paginated feed replaces the 5 MB whole-load.** The orchestrator pulls rows in pages bounded by `FEED_PAGE_BYTES` (with a `FEED_PAGE_MAX_ROWS` ceiling, whichever hits first) by reusing `DatasetService.listRecords` (the existing `chunkOffsets` range read) **with a byte cap added**; it generates that page's cells, dispatches them through the existing semaphore, then discards the page. The progress **total is computed up front from `dataset.rowCount × targets`** (PG-authoritative, ADR-032) so pagination doesn't break the progress denominator or the ClickHouse `startExperimentRun({total})`. **Abort is plumbed into the feed loop** (the feed takes `runId` and checks `abortManager.isAborted` between pages and before each S3 read). *Rejects:* the current whole-array load (5 MB truncation + OOM); a **fixed row-count page** (a 500-row page of 14 MB rows = ~7 GB heap — red-team); a chunk-aligned page (size swings with row weight); and the no-`chunkOffsets` whole-dataset fallback in `listRecords` (require the offset path; legacy no-offset datasets are tiny/PG).

2. **Per-row dispatch stays; dispatch is inline-by-default, stage-heavy-by-size — no content inspection.** Reuse `invokeLambda` staging at the per-row level: serialize the invoke; over `STUDIO_INVOKE_STAGING_THRESHOLD_BYTES` → spool to a transient S3 object + presigned-URL pointer; else inline. Size is the universal, schema-agnostic gate (catches base64 images, big JSON, long text). *Rejects:* inlining heavy bytes (silent break at the 6 MB Lambda cap); content-sniffing for images (fragile).

   2a. **BYOC / self-hosted clause (red-team).** The Go fetch SSRF allow-list (`isAWSS3Host`) accepts only `*.amazonaws.com` S3 hosts; on R2/MinIO/BYOC a staged heavy row would be **rejected and fail loud**. v1 **must widen the allow-list to the project's configured storage host** (via `resolveProjectStorageDestination` / `ALLOWED_PROXY_HOSTS`) so pointer dispatch works off-AWS. The self-hosted nlpgo (non-Lambda) branch has no 6 MB cap but also never stages — bound its inline read by the same byte budget.

3. **Run results use a lean shape: light columns inline, heavy columns referenced.** At result-write (`recordTargetResult`), each column value **under `RESULT_INLINE_BYTES`** is copied into the result `entry` (grid stays readable + searchable); each value **over** it is dropped and replaced by a reference resolved at read from the dataset row by **(`projectId`, `datasetId`, `rowId`)**. ADR-022's lean-projection pattern, size-gated identically. *Rejects:* keeping the full-row copy (re-stores GB into ClickHouse a second time, per target); pure reference-everything (grid loses readable text on any dataset change).

   3a. **This requires threading the stable `rowId` through the run path** — the foundational red-team fix. `dataLoader` must keep `r.id` → `LoadedDataset.rows` carry it → `ExecutionCell.rowId` → `recordTargetResult({datasetId, rowId})` → CH. The reference is the **persisted** stable `record_<nanoid>` id (ADR-032), treated as **opaque** (PG and s3_jsonl use different id formats). *Rejects:* row index/position (shifts on insert/delete → wrong row); read-minted ids (`adaptS3JsonlRecord` mints a fresh id for an id-less line — depend only on persisted ids); a dataset snapshot/version (pulls unbuilt versioning in; reproducibility-forever is moot under retention). **Inline datasets** (`dataLoader.ts` inline branch) have no stable id → they **stay full-copy**; `recordTargetResult` branches on it.

4. **Heavy columns are resolved ONLY for interactive display; bulk readers return references.** The grid and the comparison view resolve referenced heavy columns for **on-screen rows only**, `projectId`-first (cross-tenant returns nothing — ADR-022 / ADR-032 I-TENANT), degrading a missing/edited row to a clear **"unavailable"** (net-new UI, not a free blank). **Bulk readers do not materialize heavy columns:** CSV export emits a **reference/placeholder** for heavy columns; the external REST results API returns the **lean shape + reference** (a documented contract change for scripts that expected inline values). *Rejects:* resolve-everything for export/REST (relocates the OOM/egress we removed into the bulk path — red-team).

5. **Old results read unchanged (dual-read), no backfill.** A result with no `datasetId`/`rowId` is a legacy full-`entry` row and renders inline; one with references resolves heavy columns. The read path handles both. *Rejects:* rewriting historical results.

6. **Large-run soft confirmation.** A run over `LARGE_RUN_CONFIRM_ROWS` requires explicit confirmation ("about to evaluate N rows — heavy, slow, costs money"); soft confirm, not a hard block. *Rejects:* no guard (surprise cost); a hard cap (legitimate large runs must be possible).

7. **Behind a flag; off = byte-for-byte today.** `release_dataset_streaming_reads` (PRODUCT-scoped, default off) → the 5 MB cap + full-row result copy, unchanged. The reference fields use a reserved namespace excluded from the user-visible column/facet enumeration (ADR-022's `langwatch.reserved.*`), so they never surface as a fake "column." *Rejects:* an unflagged rollout of a customer-data result-shape change.

8. **Self-hosted keeps working.** Reference resolution goes through `getFullDataset`/`findOne`, which already serve PG datasets (`contentLayout='postgres'`) and local-FS storage; only the D2a allow-list widening is added. *Rejects:* an S3-only resolution path.

9. **Batched execution is not durable-queue-backed; a mid-run death is a partial run.** Per the accepted constraint, the paginated dispatch does not ride the event/outbox queue; a worker death leaves a partial run (orphaned ClickHouse `experiment_run_items` + a `total` that never completes), re-run from scratch (new `runId`, no collision). v1 has **no orphaned-run cleanup** — documented. *Rejects:* outbox-backed at-least-once resume (over-built for v1).

**Divergence from ADR-022 (load-bearing).** ADR-022's source (`event_log`) is **immutable append-only** — references never drift, and it can **fail-open** (inline on spool failure). Our source (the dataset) is **mutable and deletable**, which is why (a) we accept drift + "unavailable" + lean on retention rather than build snapshots (D3a), and (b) we **fail loud** on an un-stageable heavy row — inlining it would break the Lambda. Same pattern, opposite failure posture, because the source isn't an immutable log.

## Constants

| Name | Value | Purpose |
|---|---|---|
| `FEED_PAGE_BYTES` | ~24 MiB (env-tunable) | Byte budget per page the orchestrator reads + dispatches + discards. Bounds TS memory regardless of row weight. |
| `FEED_PAGE_MAX_ROWS` | 1000 (env-tunable) | Row ceiling per page (whichever hits first with `FEED_PAGE_BYTES`). |
| `STUDIO_INVOKE_STAGING_THRESHOLD_BYTES` | ~5 MiB (existing) | Per-invoke size gate: over → stage to S3 + pointer, else inline. Under the 6 MB Lambda cap. Reused, not new. |
| `RESULT_INLINE_BYTES` | ~64 KB (env-tunable) | Per-column gate at result-write: under = copied inline, over = referenced. Mirrors ADR-022 `IO_PREVIEW_BYTES`. |
| `LARGE_RUN_CONFIRM_ROWS` | 100 (env-tunable) | Row count above which a run needs explicit confirmation. |
| Lambda limits | 2 GB / 900 s / 6 MB payload | Context — the per-invoke envelope must stay under 6 MB; staging enforces it. |
| `release_dataset_streaming_reads` | flag, default off | PRODUCT-scoped gate; off = today's behavior byte-for-byte. |

## Invariants

| ID | Invariant | Test anchor |
|---|---|---|
| I-WHOLE | A run executes **every** row, not a 5 MB prefix. | Run on a dataset > 5 MB → every row dispatched + scored; count matches `rowCount`. |
| I-MEM-TS | TS peak memory is bounded by the page **byte budget**, independent of dataset size or row weight. | Run a dataset of 14 MB rows ≫ heap → completes; orchestrator memory flat at ~`FEED_PAGE_BYTES`. |
| I-PAYLOAD | No dispatch inlines bytes over the staging threshold; heavy rows go by pointer; an un-stageable row fails **loud**. On non-AWS storage the allow-list must include the storage host (D2a) or heavy rows fail. | Dispatch a row > threshold → staged + small payload; BYOC host in allow-list → resolves; absent → clear failure, no truncated send. |
| I-RESULT-LIGHT | A result's light columns survive dataset-row deletion; heavy columns degrade to "unavailable" (explicit UI), never crash. | Delete the referenced row → result renders light columns + "unavailable". |
| I-NO-BULK-HEAVY | Heavy columns are never bulk-materialized; only interactive on-screen rows resolve them. Export/REST emit references. | Export/REST a 14 GB run → response bounded, carries references not image bytes. |
| I-TENANT | Reference resolution is `projectId`-first; a ref to another project's row resolves to nothing. | Resolve a cross-project ref → empty, no leak. |
| I-COMPAT | Flag off = today's behavior byte-for-byte (5 MB cap + full-row result copy). | Flag off → identical reads, dispatch, stored result shape. |
| I-DUALREAD | Legacy results (full inline `entry`, no ref) render unchanged with the flag on. | Read a pre-flag result → renders inline; no backfill. |
| I-GUARD | A run over `LARGE_RUN_CONFIRM_ROWS` requires explicit confirmation. | Run over the threshold → confirmation required before dispatch. |

## Schema

No dataset-storage schema change (reuses ADR-032 chunks + `chunkOffsets`).

**ClickHouse / result command — additive, optional:**
```ts
// experiment-run-processing/schemas/commands.ts — recordTargetResult
{
  index: number,                  // existing run-row position
  entry: Record<string, unknown>, // CHANGED: light columns only (values > RESULT_INLINE_BYTES omitted)
  predicted?: Record<string, unknown> | null, // unchanged — model output, already small
  datasetId?: string,             // NEW optional — reference target (absent on legacy/inline → dual-read/full-copy)
  rowId?: string,                 // NEW optional — stable record id (opaque), NOT index
}
```

**TS run-path plumbing — NOT additive, real work (red-team):** `dataLoader.loadDataset` must stop dropping `r.id`; `LoadedDataset.rows` carry the id; `ExecutionCell` gains `rowId`; `recordTargetResult` carries `datasetId + rowId`. Inline datasets stay full-copy. CH side is additive (no migration, no replay); legacy rows lack the fields and read inline (I-DUALREAD).

## Rejected alternatives

- **Whole-dataset load (status quo)** — 5 MB truncation + TS OOM (D1).
- **Fixed row-count page** — heavy-row page blows the heap (D1, red-team).
- **Chunk-aligned page / no-offset whole-dataset fallback** — uneven / unbounded (D1).
- **Inline heavy bytes in the payload** — silent break at the 6 MB Lambda cap (D2).
- **Content-sniffing for images** — fragile; size is the universal gate (D2).
- **Keep copying the full row into results** — re-stores GB a second time, per target (D3).
- **Reference everything (no light copy)** — grid loses readable text on any dataset change (D3).
- **Reference by row index** / **read-minted id** — drifts / non-stable (D3a).
- **Snapshot / dataset versioning for results** — unbuilt versioning in scope; moot under retention (D3a).
- **Resolve-everything for export/REST** — relocates the OOM/egress into the bulk path (D4, red-team).
- **Per-image ingest/freeze pipeline** — ADR-021's superseded "permanent per-field blob offload"; chunks are the durable source, staging is the spool (Context).
- **Fix all engines now** — the Studio/Optimize Go engine needs a streaming + flush rewrite; too large for v1 (Scope).
- **Durable-queue-backed run resume** — over-built for v1 (D9).

## Consequences

**Positive.** Large datasets run on every row; TS and Lambda memory bounded by the page byte budget; results stop storing a second copy; reuses #4910 + ADR-022 patterns + ADR-032 storage (incl. `listRecords`) with no new services; flag-gated, reversible, byte-for-byte off.

**Negative.**
- **Threading `rowId` through the run path is real plumbing** (loader → cell → result → CH), not the additive change v1 first implied.
- Results gain a **live dependency on the dataset** — delete the dataset/row → heavy columns show "unavailable" (light survive). "Unavailable" is **net-new UI**.
- **Forgotten readers all need touching:** the grid + comparison resolve visible rows (comparison otherwise shows silent false "no difference"); CSV export + REST API change contract to emit references; Optimization Studio's results panel shares the transform, so its **display** changes even though its run engine is deferred.
- **BYOC/self-hosted:** pointer dispatch needs the allow-list widened to the storage host, else heavy rows fail on R2/MinIO/BYOC.
- **Studio/Optimize/workflow run engine stays 5 MB-capped** until the follow-up.
- A **mid-run death loses progress** and leaves orphaned ClickHouse rows (no v1 cleanup).
- Per-row fan-out is **3000 invokes/run** (1000 × 1 target × 2 evals); the concurrency-10 semaphore is **per-pod, not global** — no global Lambda concurrency ceiling in v1.

**Neutral.** Light columns still copied (small); chunking unchanged; resolution reuses the paginated reader; the large-run guard is additive UI.

## Open questions

- **Studio "Evaluate"/"Optimize"/workflow streaming** — follow-up ADR (Go streaming input + periodic result flush). Owner: TBD.
- **Standalone dataset-editor page lazy-load** — separate UI surface, follow-up.
- **Global Lambda concurrency ceiling** — the per-pod semaphore doesn't cap account-wide invokes; do we need a global limiter for large concurrent runs?
- **Orphaned-run cleanup** — a sweeper for abandoned partial runs (out of v1).
- **Exact values** — `FEED_PAGE_BYTES`, `RESULT_INLINE_BYTES`, `LARGE_RUN_CONFIRM_ROWS`; tune against real datasets.
- **True reproducibility** — dataset versioning (ADR-032 designed-for) if frozen golden-dataset runs become a hard requirement.

## Revisions

- **v1 (2026-06-18)** — initial decision. Forks: dispatch = inline-default + stage-by-size, no content sniff; results = hybrid lean (light inline + heavy by stable-row-id reference, dual-read, no snapshot); scope = experiments-v3 only (Studio deferred); feed = pages of N rows; large-run = soft confirm > 100. Derived: UI = experiment grid lazy-load in v1; failure = non-durable. Dissolved: chunking change (chunkOffsets suffices). Folded ADR-022 precedent (lean-projection + size-gate + flag + tenant-first + reserved-namespace); mutable-source divergence documented.
- **v2 (2026-06-18) — red-team fold (`/challenge`).** Verdict "needs more thinking"; two blockers + corrections. **(D3a, blocker)** the stable `rowId` is dropped in `dataLoader` and the orchestrator is positional — the reference key must be threaded loader→cell→result→CH; the Schema "additive only" framing was corrected to "additive CH + real TS plumbing." **(D4, blocker)** forgotten readers added: REST results API + CSV export + comparison view + the Optimization Studio results-panel scope leak; resolved via re-asked forks → **export emits references/placeholders, REST returns lean+reference** (documented contract change), interactive grid/comparison resolve visible rows only; "unavailable" acknowledged as net-new UI; new invariant **I-NO-BULK-HEAVY**. **(D1)** feed re-decided from fixed-row-count to **byte-budgeted pages** (a 500-row page of 14 MB rows = ~7 GB heap) reusing `listRecords`, progress total taken from `dataset.rowCount` up front, abort plumbed into the feed loop. **(D2a)** BYOC/self-hosted clause: the Go fetch SSRF allow-list is AWS-S3-only → must widen to the project storage host or heavy rows fail off-AWS. **(D3a)** ignore read-minted ids; treat rowId opaque (two id formats). **(D9)** mid-run death leaves orphaned CH rows, no v1 cleanup. Added open questions: global Lambda concurrency ceiling, orphaned-run cleanup.
