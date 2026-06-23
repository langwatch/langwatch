# ADR-032: Dataset content moves to S3 as chunked JSONL, with direct upload and an async normalize job

**Date:** 2026-06-17

**Status:** Accepted

> **One-line:** Dataset **content** moves out of **Postgres** into **S3 as ~16 MB JSONL chunks**, large files upload **browser→S3 via a presigned upload to a server-owned staging key**, a **standalone GroupQueue job** normalizes them off-thread under a streaming contract (recoverable by manual retry), and existing datasets are **flip-all-at-once migrated by a hardened, advisory-locked job off the boot path** — all behind the existing `resolveProjectStorageDestination` seam so self-hosted and BYOC keep working.

## Context

Dataset content lives in Postgres today (`DatasetRecord`, one row per entry), so uploads are size-capped (`MAX_FILE_SIZE_BYTES` 25 MB / `MAX_ROWS_LIMIT` 10k in `src/server/datasets/upload-utils.ts`) and a customer with 2–3 GB base64-image datasets cannot onboard. The upload modal also parses the whole file in-browser before upload (`src/components/datasets/UploadCSVModal.tsx`), which OOMs the tab on large files. An ~2-year-old "datasets in S3" path exists but is legacy and the wrong shape — a single JSON blob at `datasets/{projectId}/{datasetId}` with full read-modify-write per edit (`src/server/storage.ts`). It's superseded by `contentLayout`, but NOT fully dead: the create path still sets `Dataset.useS3 = Organization.useCustomS3`, so a `useCustomS3` org keeps writing the flag (the legacy single-blob reader is what's effectively unused). We **rewrite, not reuse**; we keep only the plumbing (`createS3Client`, `resolveProjectStorageDestination`, the `datasets/{projectId}/...` key scheme).

End state: **no dataset *content* in Postgres.** Dataset *metadata* (id, name, slug, columnTypes, mapping, projectId — the relational FKs) stays in PG; only the bulk row content moves to S3 as JSONL.

**Blast radius** is customer data — the migration rewrites existing dataset content — so this ADR carries explicit invariants with test anchors and was put through an adversarial red-team (folded as v2 below).

**Scope honesty.** This epic delivers **upload + storage + migration**. It does **not** fix dataset *reads*: `getFullDataset` truncates at 5 MB (`src/server/api/routers/datasetRecord.utils.ts`) and run paths (`experiments-v3/execution/dataLoader.ts`, `optimization_studio/server/loadDatasets.ts`) call it un-overridden, so a 2 GB dataset is only partially consumed by a run. Making the uploaded data fully usable needs batched/streaming reads — the **immediate fast-follow epic**.

**Prior art / related decisions.**
- **ADR-024 (cold-path tiered storage)** — precedent that object storage is "deployment shape, not a customer feature," with self-hosted-may-not-have-S3 gated by env. Our storage-gating mirrors it.
- **ADR-022 (data retention)** — "retention *charging*, not auto-deletion" is the model for the deferred dataset-storage billing.
- **ADR-007 / 023 / 026 (event sourcing, GroupQueue)** — the GroupQueue is the in-house Redis FIFO substrate that replaced BullMQ; `registerJob` schedules standalone one-shot work on it.
- **#4547** removes the BullMQ legacy stack (`src/server/background/`); **#4498 (outbox)** and **#4743** build the GroupQueue-based replacement. New async work must not use BullMQ.
- **ADR-019** + `CLAUDE.md` — Hono route → service → repository; `projectId` on every query.

## Decision

1. **S3 is the sole store for dataset *content*; Postgres keeps only *metadata*.** Content is JSONL. The `Dataset` row stays in PG so evaluations/projects keep their FKs. Rejects PG content storage (size-capped) and the dead single-blob S3 path.

   *Implementation (v7):* R1/R3 object storage is realized via a provider-pluggable `DatasetStorage` service (DIP) — a single interface (`writeChunks`/`readChunks`/`createPresignedUpload`/`headStagedObjectSize`/`deleteStaged`) with `S3DatasetStorage` and `LocalDatasetStorage` impls selected by `getDatasetStorage(projectId)` through `resolveProjectStorageDestination`. The impls are plain injectable classes (no module-global singletons beyond a per-project S3 client memo), getApp-registerable later.

2. **Content is ~16 MB byte-capped JSONL chunks under `datasets/{projectId}/{datasetId}/`, ordered zero-padded keys** (`chunk-00000.jsonl`, …). The byte cap is the only hard chunk bound in v1 — small enough to bound normalize memory and the future paginated read's per-chunk I/O, large enough to avoid object explosion (~128 objects per 2 GB). A fixed *row-count* cap is rejected (a low value explodes object count + the offset index on light-row data); the row-count ceiling is deferred to the reads epic. **PG is authoritative for addressing** (`rowCount`, `sizeBytes`, `chunkCount`, per-chunk row offsets); S3 LIST is repair/audit only, not the read path. Rejects a manifest object (drift), S3-LIST-authoritative reads (eventual consistency on overwrite/delete), and a low fixed row cap (object explosion on light rows).

3. **Append writes a new chunk; edit/delete rewrites only the affected chunk** (located via the row-offset index), under the per-dataset advisory lock (Decision 9). Rejects tombstone/overlay and change-log+compaction (over-built for an upload-and-read workload).

4. **Heavy uploads go browser→S3 directly via a presigned upload; the backend never receives file bytes, the client never parses the file.** The upload key is **server-generated and scoped to a single `staging/{projectId}/…` object** (tenant isolation — the browser performs the write, so the key is locked at presign time), with a short TTL and the **size cap enforced at *finalize*** (HEAD the staged object; reject + delete if over `UPLOAD_MAX_BYTES`). The presign is a **PUT** via the already-installed `s3-request-presigner` (no new dep); a POST-policy that rejects *before* bytes land (`createPresignedPost`) is deferred hardening (v6). The normalizer reads only from the staging prefix and writes chunk keys itself — a client can never presign a live chunk key. Self-hosted without browser-reachable S3 instead mints a **same-origin streaming staging route** (the app receives the PUT and streams it to local-FS staging), so heavy uploads work without S3 too — the bytes transit the app, accepted for single-pod self-host (v14). The presign/finalize/retry routes are reachable by the **browser session cookie** (not API-key-only), with an API-key fallback for the SDK, and enforce `datasets:manage` + project membership on the client-supplied `projectId` (v10). Rejects backend-proxied upload, size-threshold split, client-influenced keys, unbounded PUT.

5. **Normalize (raw CSV/JSONL in S3 → chunked JSONL) runs off-request as a standalone GroupQueue job (`registerJob`), idempotent and dedup-keyed — pure Postgres + S3, no ClickHouse.** A mechanical one-shot transform, deliberately not modelled as a domain event. It is held to a **streaming/memory contract** so it doesn't fall over: true backpressured streaming (read-stream → record transform → chunk-writer stream, never an in-memory array), **concurrency = 1** for the normalize group (a heavy job can't OOM the shared worker and take down folds/projections), and a **fast reject above `UPLOAD_MAX_BYTES`**. If a job is interrupted (worker death), nothing is lost — the dataset stays at `status=processing` with PG rows and the staging file intact, and is recoverable via a **manual retry** (re-enqueue); a stuck dataset is never a dead end. Rejects BullMQ (deleted, #4547), synchronous-in-request (timeout on GB files), and `.withOutbox`/reactor/fold (pulls ClickHouse into a PG-only domain + depends on unmerged #4498). A standalone cron sweeper for auto-recovery was considered and dropped as unnecessary (see Revisions v2).

6. **The dataset carries a PG `status` column** (`uploading` → `processing` → `ready` / `failed`), typed `String @default("ready")` so existing rows stay valid; the normalize job flips it. **Every read consumer gates on `status=ready`** — UI (polls), the Go engine via `loadDatasets.ts`, the REST `/upload` append path, and the SDK — so a half-normalized dataset is never served. Rejects a ClickHouse fold projection (PG-only domain) and a Prisma enum (house style uses `String` for lifecycles).

7. **Existing dataset content is migrated PG→S3 flip-all-at-once by an idempotent, advisory-locked job — off the blocking boot path.** The same task runs from three triggers, never on the `set -e` boot path: **cloud** k8s Job · **self-hosted Helm** `post-install,post-upgrade` **hook Job** · **compose/bare** `pnpm run task`. It **self-skips** when storage is unconfigured or no datasets remain on `contentLayout='postgres'` — so it's safe to fire every upgrade and effectively runs "only if old PG rows remain." A **per-dataset Postgres advisory lock** guarantees exactly one pod migrates a dataset. The new layout is marked by a dedicated **`contentLayout` field** (`postgres`|`s3_jsonl`), load-bearing for two reasons **independent of old pods**: **(a) the migration's per-dataset idempotency/resume marker** — the loop processes `postgres`, skips `s3_jsonl`; **(b) per-dataset read routing** during the incremental migration window, when migrated and not-yet-migrated datasets coexist and the *new* code must know where each dataset's content lives. It's a fresh field rather than an overload of the dead **`useS3`** flag (whose branch points at the to-be-deleted single-blob reader). **The flip is rollout-gated:** the Job/hook runs *after* the deploy completes, so no old-image pod is present when a dataset flips → migrated datasets never diverge. As **defense-in-depth only** (rollout-gating already prevents the scenario), an un-drained old pod reading a flipped dataset sees an unknown `contentLayout` and falls back to PG (the backfill **never deletes PG rows**). The only residual is a *net-new* S3 dataset created by a new pod mid-rollout being briefly invisible to a still-draining old pod (transient "not found", resolves when the deploy finishes) — accepted rather than adding a dual-write window. Dropping `DatasetRecord` is a **separate later migration** after confirmed full cutover. Safe because the existing corpus is hard-capped at 25 MB / 10k rows and new datasets are **born on storage** — every create path writes `s3_jsonl` directly (chunk write before the row insert, self-reaping on failure), so no new `postgres` content appears and the backfill drains to zero (v13). **Storage is therefore mandatory on create: no Postgres fallback** — a self-host install must provide a writable backend (S3 or a writable local-FS path), else the create fails loud with an actionable error. Rejects boot-blocking the migration, overloading `useS3`, the no-lock backfill, and a dual-write window.

8. **Bucket and credentials are resolved through `resolveProjectStorageDestination` (never hardcoded); all S3-dependent behavior gates on "storage configured," and boot never fails when S3 is absent.** Single-instance self-hosted may use local FS; multi-pod requires S3. The BYOC route choice is deferred — the resolver seam keeps it additive. Rejects a hardcoded global bucket and building on the dead `useCustomS3` DB route.

9. **A per-dataset advisory lock serializes every chunk-mutating operation** — migration, normalize, append, edit/delete. The GroupQueue normalize group is keyed by `datasetId` (single-writer); appends/edits take the same lock. This makes `chunkCount`/`chunkOffsets` safe to treat as authoritative. Rejects lock-free last-writer-wins (silently lost appends, offset-index drift).

## Constants

| Name | Value | Purpose |
|---|---|---|
| `CHUNK_MAX_BYTES` | ~16 MB | Byte cap per JSONL chunk; rolls over when the next row would exceed it (oversized single row still gets its own chunk). Only hard chunk bound in v1; row-count ceiling deferred to the reads epic. |
| Chunk key format | `datasets/{projectId}/{datasetId}/chunk-{NNNNN}.jsonl` | Ordered, zero-padded, tenant-prefixed. PG-authoritative; LIST is repair-only. |
| Staging key format | `staging/{projectId}/{uploadId}` + bucket lifecycle TTL | Server-owned upload target; lifecycle rule reaps orphaned un-finalized uploads. |
| `UPLOAD_MAX_BYTES` | ~5 GiB (tunable) | Hard size cap — enforced at finalize (HEAD + reject/delete). Set above the 2–3 GB use case; make env-driven later. |
| `LARGE_JSON_MAX_BYTES` | ~100 MB | Cap for single-array `.json` uploads, which can't be stream-parsed without a new dep. Over this, normalize fails the dataset with "convert to JSONL". CSV/JSONL stream and have no such cap. |
| Normalize concurrency | 1 per normalize group | A heavy normalize can't OOM the shared worker. |
| `Dataset.contentLayout` default | `"postgres"` | New-layout marker + migration done-flag; old pods ignore it → fall back to PG. |
| `Dataset.status` default | `"ready"` | Keeps every pre-existing row valid without backfill. |
| `SKIP_DATASET_S3_MIGRATE` | env, unset/false | Opt-out for the migration task (cloud Job / Helm hook Job). |

## Invariants

| ID | Invariant | Test anchor |
|---|---|---|
| I-PG | A dataset on the new layout (`contentLayout='s3_jsonl'`) has zero `DatasetRecord` rows. | Migrate/create → assert `count(DatasetRecord)=0`. |
| I-MIG | Migration never deletes PG content before the S3 write is confirmed; old-image pods keep reading PG mid-deploy. | Kill mid-run → PG intact + still served; re-run completes; old-pod read still resolves via PG. |
| I-RECOVER | A normalize interrupted by worker death loses nothing and is recoverable. | SIGKILL the worker mid-normalize → dataset stays `processing`, PG + staging intact; manual retry re-runs to `ready`. |
| I-MEM | Normalize memory is bounded regardless of file size; one heavy job can't OOM the shared worker. | Normalize a file ≫ heap at concurrency 1 → completes; second normalize queues, doesn't co-run. |
| I-IDEM | Re-running normalize (dedup hit or re-drive over partial chunks) never duplicates rows. | Run twice, and re-drive after a crash that wrote 5/8 chunks → `rowCount` correct, chunk set consistent. |
| I-READY | A dataset is served only at `status=ready`; `processing`/`failed` never serves partial rows — across UI, Go engine, REST, SDK. | Read during `processing` from each consumer → not-ready, never partial. |
| I-COUNT | PG `rowCount`/`sizeBytes`/`chunkCount` match actual S3 chunks after normalize, even under concurrency. | Concurrent migrate/append → advisory lock serializes → counts match objects. |
| I-TENANT | Every dataset/staging key is `projectId`-prefixed; the upload presign is scoped server-side to one key the client cannot alter. | Attempt to presign/write outside the project prefix → rejected at presign. |
| I-NULL | `stripNullBytes` runs on the JSONL write path. | Write a row containing U+0000 → stored sanitized. |
| I-SELFHOST | Self-hosted without S3 uses local FS (chunked JSONL fully supported); boot succeeds. Storage is mandatory on create (v13) — an unwritable path fails loud with an actionable error, never a silent PG fallback. | Boot with no S3 → no crash; create + read via local FS work; unwritable path → typed `StorageNotWritableError`. |

## Schema

```prisma
model Dataset {
  // ...existing: id, projectId, name, slug, columnTypes, mapping, createdAt, updatedAt, archivedAt
  // useS3 left UNTOUCHED (legacy single-blob path, superseded by contentLayout; still written for useCustomS3 orgs) — the new layout uses contentLayout so old pods don't misroute
  contentLayout String  @default("postgres") // postgres | s3_jsonl — new-layout marker + migration done-flag
  status        String  @default("ready")    // uploading | processing | ready | failed
  statusError   String?                      // normalize failure detail for the UI
  rowCount      Int?                         // authoritative count (supersedes s3RecordCount)
  sizeBytes     BigInt?                      // total stored bytes — billing-ready (deferred)
  chunkCount    Int?                         // JSONL chunk objects — PG-authoritative; S3 LIST is repair-only
  chunkOffsets  Json?                        // per-chunk row ranges — PG-authoritative for addressing
}

// DatasetRecord: UNCHANGED here. Dropped in a SEPARATE later migration after full cutover (Decision 7).
// No ReactorOutbox / ClickHouse changes — normalize is a standalone GroupQueue job (Decision 5).
```

Migration is additive (new nullable columns + defaults); existing rows become `status="ready"`, `contentLayout="postgres"`, served from PG until the migration job flips them to `s3_jsonl`.

## Consequences

**Positive.** Multi-GB datasets become uploadable; Postgres is unburdened of bulk content; the upload no longer parses in-browser on the direct path (raw file streamed to storage; the in-browser parse survives only on the no-storage fallback) (v10); versioning and billing seams are in place (per-chunk objects + `sizeBytes`); the async path uses the GroupQueue substrate, not BullMQ; worker-death and concurrency are handled, not assumed.

**Negative.**
- A PG-only domain schedules work on GroupQueue via the `registerJob` escape hatch — a conscious exception to event-driven.
- **Reads are not fixed by this epic** — the 5 MB run-time truncation persists, so uploaded multi-GB data is only partially consumed by runs until the batched-reads fast-follow.
- Uploads gain an async `processing` lifecycle that every read consumer must gate on.
- Presigned upload needs bucket CORS (browser PUT) + a finalize-time size cap (HEAD); self-hosted needs browser-reachable S3/MinIO or the backend fallback.
- A staging-prefix lifecycle rule is required or orphaned un-finalized uploads accumulate.
- `DatasetRecord` lingers in PG until the deferred drop migration.
- **Storage is mandatory on dataset create — no Postgres fallback (v13).** A self-host install must provide a writable backend (S3 or a writable `LANGWATCH_LOCAL_STORAGE_PATH`); an unwritable path fails the create loud (typed `StorageNotWritableError`) rather than silently falling back to PG. Narrows I-SELFHOST.
- **I-COUNT is eventually consistent / repairable on edit/delete, not unconditionally atomic.** An edit/delete writes the S3 chunk then commits the PG counters inside `withDatasetLock`; an S3 failure rolls the PG transaction back cleanly, but a PG-commit failure *after* the S3 write succeeds leaves the chunk mutated with the counters rolled back → drift. The repair is `recomputeDatasetCounts({ projectId, datasetId })` (re-derives `rowCount`/`sizeBytes`/`chunkOffsets` from the actual chunk bytes under the lock), runnable on a detected mismatch. This window is rare (commit-after-write only) and the residual is over-/under-count, never lost rows.

**Neutral.** `useS3` is left for the legacy path (superseded by `contentLayout`, still write-enabled for `useCustomS3` orgs); `contentLayout` drives the new layout; datasets gain a status lifecycle; reads use chunks only when `contentLayout='s3_jsonl'`.

## Open questions

- **Batched/streaming dataset reads** — the immediate fast-follow epic.
- **`UPLOAD_MAX_BYTES`** — pick a concrete value before implementation.
- **Automatic re-drive** (poll-triggered, no scheduler) and the **`.withOutbox` migration** — optional later hardening; v1 ships manual retry only.
- **Chunk row-count ceiling** — value deferred to the reads epic; v1's only hard bound is the ~16 MB byte cap (Decision 2). (Self-hosted migration trigger resolved in Decision 7 — Helm hook Job.)
- **POST-policy hardening** — adopt `createPresignedPost` (`@aws-sdk/s3-presigned-post`) to reject oversize *at upload* rather than at finalize; deferred (v6 ships PUT + finalize guard, dep-free).
- **BYOC route** — decommission the dead `useCustomS3` DB route or wire `DATAPLANE_S3__`; deferred, resolver seam keeps it additive.
- **S3-native versioning** & **storage billing** — designed-for, deferred (`sizeBytes` captured now).
- **Drop-`DatasetRecord` migration** — separate, gated on confirmed full cutover.

## Revisions

The Decision / Constants / Invariants / Schema / Consequences sections above are the **current accepted state**. This log keeps only the decision-level evolution; per-PR review/hardening folds live in the PR and commit history, not here.

- **v1 (2026-06-17) — initial decision.** Chunk addressing → ordered S3 keys + PG counters; edit/delete → rewrite affected chunk; upload → always direct-to-S3; normalize → standalone GroupQueue job; `status` lifecycle on `Dataset`; migration → flip-all-at-once. BYOC deferred.
- **v2 (2026-06-17) — red-team fold.** Migration moved off the boot path; per-dataset advisory lock (D9); `contentLayout` replaces the `useS3` overload (D7); presign key server-owned + scoped + size-capped (D4); status-gating extended to every read consumer (D6); counters made PG-authoritative; the 5 MB read truncation acknowledged out of scope (batched reads = the immediate fast-follow); worker-death recovery via manual retry, no sweeper/ClickHouse/scheduler (D5).
- **v5–v6 (2026-06-17) — constants + upload mechanism.** Chunk byte cap **100 MB → ~16 MB** (D2; fixed row cap rejected, row-count ceiling deferred to the reads epic). Self-hosted migration trigger → Helm `post-install,post-upgrade` hook Job (D7). Upload mechanism settled as **presigned PUT + finalize-time HEAD size cap** rather than a POST-policy (dep-free; `@aws-sdk/s3-presigned-post` not installed); `UPLOAD_MAX_BYTES` ~5 GiB.
- **v7 (2026-06-17) — DIP refactor, no decision changed.** Object storage moved behind the `DatasetStorage` interface (`S3DatasetStorage` / `LocalDatasetStorage`, selected by `getDatasetStorage(projectId)` via `resolveProjectStorageDestination`); pure chunk math (`dataset-chunking.ts`) and presign policy (`presigned-upload.ts`) extracted and unit-tested in isolation.
- **v8–v12 (2026-06-18) — implementation + memory/review hardening, no decision changed.** Standalone `datasetNormalize` GroupQueue job realizing D5's streaming contract (JSONL via `readline`, CSV via papaparse `step`, single-array `.json` buffered + capped at `LARGE_JSON_MAX_BYTES`). I-COUNT clarified as repairable-on-edit/delete via `recomputeDatasetCounts`. Browser upload flow wired end to end (raw-file streaming with no in-browser parse; session-cookie auth with API-key fallback, membership-checked — reviewed no-IDOR/no-CSRF; `async-processing-ui.md` extracted). Bounded-memory reads/pagination/export guards (`chunkOffsets`-scoped reads, `DatasetTooLargeToExportError`, `ChunkTooLargeError`). CORS-failure fallback to the backend path; `withDatasetLock` 120 s timeout; not-ready → REST 425 / tRPC `PRECONDITION_FAILED`.
- **v13 (2026-06-21) — born-on-storage cutover (PRs #4908, #5017).** ALL create paths (tRPC `create`, REST `POST /` + `/upload`, copy/clone, SDK/MCP) are born `contentLayout='s3_jsonl'` — chunk write before the row insert, self-reaping on failure — so no new `postgres` content appears and the backfill drains to zero; the chunk-mutation logic centralizes in `dataset-mutations.ts`. **Storage is now mandatory on create — no Postgres fallback** (folded into D7 / I-SELFHOST / Consequences above): a writable backend is required (S3 or a writable local-FS path), else create fails loud with a typed `StorageNotWritableError`. Migration prefers S3, falls back to local FS (dry-run + per-project tenancy-safe scan). Delete does **trailing-chunk logical compaction** (empties dropped from `chunkCount`; objects left as benign orphans, never deleted in-tx; `recomputeDatasetCounts` throws `MissingChunkError` on a gap).
- **v14 (2026-06-22) — local-FS direct upload completes D4 (PRs #4908, #5017).** Heavy uploads no longer require S3: `LocalDatasetStorage` mints a **same-origin** streaming staging route (`putStaged`, body never buffered, size cap enforced mid-stream by an aborting counting transform) reusing the same tenant-scoped staging key, so finalize/normalize stay backend-agnostic. **Tradeoff (narrows D4):** bytes transit the app process — accepted for single-pod self-host; multi-pod/cloud configure S3 to keep the direct-to-bucket PUT. Review fold (Aryan): staging route gated on an owning `uploading` row; list counts unified via `datasetDisplayRecordCount`; caller-supplied row ids honored on every write path (`forcedIds`); CSV normalize parses `header:false` + once-only header dedup + by-index mapping (fixes equal-cell `_1` corruption).
- **v15 (2026-06-22) — consolidation, no decision changed.** Collapsed the per-PR revision log (v1–v14) into the decision-level milestones above and folded the born-on-storage final state into the Decision / Invariants / Consequences sections (I-SELFHOST corrected: storage is mandatory on create, no PG fallback). The s3_jsonl counter-writes were routed through `DatasetRepository` (layering only). The forward-looking S3-storage-service-unification proposal was pulled out of this PR into the research vault.
- **v16 (2026-06-22) — scan-before-lock for edit/delete (stacked PR), no decision changed.** Implements the previously-deferred optimization (v12). The O(chunkCount) id-locate scan now runs OFF the advisory lock (`locateIdsBeforeLock`); under the lock the fast path re-reads only the affected chunk(s) and takes every unaffected chunk's `(rowCount, byteSize)` from the authoritative offset index, shrinking lock-held S3 reads from O(chunkCount) to O(affected). Correctness is preserved by re-validation under the lock: the fast path commits only when the pre-scan located every target id and the offset index covers every chunk, and **bails to the proven full in-lock scan** if any located id isn't where the hint said (a concurrent move/delete since the scan) — so a future compaction/vacuum that moves rows between chunks can't cause a silently-missed delete. The pre-scan is skipped for a not-ready dataset (no storage I/O ahead of the readiness gate). **Why trusting the offset index is safe across all create paths:** every chunk producer — migration (`backfillDatasetContentToS3` → `chunkedMeta(written)`), born-on-storage create (`writeInitialS3JsonlChunks`), normalize (`StreamingChunkWriter.finalize`), and append — builds `chunkOffsets` through the single `toJsonlChunks`/`chunkedMeta` primitive, which guarantees `chunkOffsets.length === chunkCount`, contiguous `0..n-1` indices, and accurate per-chunk `byteSize`/`endRow-startRow`. So a PG→S3 *or* PG→local migrated dataset is offset-shape-identical to a born-on-storage one and the fast path handles it correctly; any dataset whose offsets don't cover every chunk (legacy/null) falls through to the full in-lock scan. Trade-off recorded: trusting the offset index for unaffected chunks means a delete no longer incidentally self-heals counter drift on those chunks; `recomputeDatasetCounts` remains the explicit I-COUNT repair.
