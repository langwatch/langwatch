# ADR-032: Dataset content moves to S3 as chunked JSONL, with direct upload and an async normalize job

**Date:** 2026-06-17

**Status:** Accepted

> **One-line:** Dataset **content** moves out of **Postgres** into **S3 as ~16 MB JSONL chunks**, large files upload **browser→S3 via a presigned upload to a server-owned staging key**, a **standalone GroupQueue job** normalizes them off-thread under a streaming contract (recoverable by manual retry), and existing datasets are **flip-all-at-once migrated by a hardened, advisory-locked job off the boot path** — all behind the existing `resolveProjectStorageDestination` seam so self-hosted and BYOC keep working.

## Context

Dataset content lives in Postgres today (`DatasetRecord`, one row per entry), so uploads are size-capped (`MAX_FILE_SIZE_BYTES` 25 MB / `MAX_ROWS_LIMIT` 10k in `src/server/datasets/upload-utils.ts`) and a customer with 2–3 GB base64-image datasets cannot onboard. The upload modal also parses the whole file in-browser before upload (`src/components/datasets/UploadCSVModal.tsx`), which OOMs the tab on large files. An ~2-year-old "datasets in S3" path exists but is dead (the `Organization.useCustomS3` flag is never set true anywhere) and the wrong shape — a single JSON blob at `datasets/{projectId}/{datasetId}` with full read-modify-write per edit (`src/server/storage.ts`). We **rewrite, not reuse**; we keep only the plumbing (`createS3Client`, `resolveProjectStorageDestination`, the `datasets/{projectId}/...` key scheme).

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

2. **Content is ~16 MB byte-capped JSONL chunks under `datasets/{projectId}/{datasetId}/`, ordered zero-padded keys** (`chunk-00000.jsonl`, …). The byte cap is the only hard chunk bound in v1 — small enough to bound normalize memory and the future paginated read's per-chunk I/O, large enough to avoid object explosion (~128 objects per 2 GB). A fixed *row-count* cap is rejected (a low value explodes object count + the offset index on light-row data); the row-count ceiling is deferred to the reads epic. **PG is authoritative for addressing** (`rowCount`, `sizeBytes`, `chunkCount`, per-chunk row offsets); S3 LIST is repair/audit only, not the read path. Rejects a manifest object (drift), S3-LIST-authoritative reads (eventual consistency on overwrite/delete), and a low fixed row cap (object explosion on light rows).

3. **Append writes a new chunk; edit/delete rewrites only the affected chunk** (located via the row-offset index), under the per-dataset advisory lock (Decision 9). Rejects tombstone/overlay and change-log+compaction (over-built for an upload-and-read workload).

4. **Heavy uploads go browser→S3 directly via a presigned upload; the backend never receives file bytes, the client never parses the file.** The upload key is **server-generated and scoped to a single `staging/{projectId}/…` object** (tenant isolation — the browser performs the write, so the key is locked at presign time), with a short TTL and a **size cap enforced via a POST-policy** (`createPresignedPost`; a presigned PUT cannot bound `Content-Length`). The normalizer reads only from the staging prefix and writes chunk keys itself — a client can never presign a live chunk key. Self-hosted without browser-reachable S3 falls back to the existing backend-upload path → local FS. Rejects backend-proxied upload, size-threshold split, client-influenced keys, unbounded PUT.

5. **Normalize (raw CSV/JSONL in S3 → chunked JSONL) runs off-request as a standalone GroupQueue job (`registerJob`), idempotent and dedup-keyed — pure Postgres + S3, no ClickHouse.** A mechanical one-shot transform, deliberately not modelled as a domain event. It is held to a **streaming/memory contract** so it doesn't fall over: true backpressured streaming (read-stream → record transform → chunk-writer stream, never an in-memory array), **concurrency = 1** for the normalize group (a heavy job can't OOM the shared worker and take down folds/projections), and a **fast reject above `UPLOAD_MAX_BYTES`**. If a job is interrupted (worker death), nothing is lost — the dataset stays at `status=processing` with PG rows and the staging file intact, and is recoverable via a **manual retry** (re-enqueue); a stuck dataset is never a dead end. Rejects BullMQ (deleted, #4547), synchronous-in-request (timeout on GB files), and `.withOutbox`/reactor/fold (pulls ClickHouse into a PG-only domain + depends on unmerged #4498). A standalone cron sweeper for auto-recovery was considered and dropped as unnecessary (see Revisions v4).

6. **The dataset carries a PG `status` column** (`uploading` → `processing` → `ready` / `failed`), typed `String @default("ready")` so existing rows stay valid; the normalize job flips it. **Every read consumer gates on `status=ready`** — UI (polls), the Go engine via `loadDatasets.ts`, the REST `/upload` append path, and the SDK — so a half-normalized dataset is never served. Rejects a ClickHouse fold projection (PG-only domain) and a Prisma enum (house style uses `String` for lifecycles).

7. **Existing dataset content is migrated PG→S3 flip-all-at-once by an idempotent, advisory-locked job — off the blocking boot path.** The same task runs from three triggers, never on the `set -e` boot path: **cloud** k8s Job · **self-hosted Helm** `post-install,post-upgrade` **hook Job** · **compose/bare** `pnpm run task`. It **self-skips** when storage is unconfigured or no datasets remain on `contentLayout='postgres'` — so it's safe to fire every upgrade and effectively runs "only if old PG rows remain." A **per-dataset Postgres advisory lock** guarantees exactly one pod migrates a dataset. The new layout is marked by a dedicated **`contentLayout` field — NOT by overloading `useS3`**. **The flip is rollout-gated:** the Job/hook runs *after* the deploy completes, so no old-image pod is present when a dataset flips → migrated datasets never diverge; an old pod reading a not-yet-flipped dataset still resolves via PG (the backfill **never deletes PG rows**). The only residual is a *net-new* S3 dataset created by a new pod mid-rollout being briefly invisible to a still-draining old pod (transient "not found", resolves when the deploy finishes) — accepted rather than adding a dual-write window. Dropping `DatasetRecord` is a **separate later migration** after confirmed full cutover. Safe because the existing corpus is hard-capped at 25 MB / 10k rows and new datasets are born on S3 (never backfilled). Rejects boot-blocking the migration, overloading `useS3`, the no-lock backfill, and a dual-write window.

8. **Bucket and credentials are resolved through `resolveProjectStorageDestination` (never hardcoded); all S3-dependent behavior gates on "storage configured," and boot never fails when S3 is absent.** Single-instance self-hosted may use local FS; multi-pod requires S3. The BYOC route choice is deferred — the resolver seam keeps it additive. Rejects a hardcoded global bucket and building on the dead `useCustomS3` DB route.

9. **A per-dataset advisory lock serializes every chunk-mutating operation** — migration, normalize, append, edit/delete. The GroupQueue normalize group is keyed by `datasetId` (single-writer); appends/edits take the same lock. This makes `chunkCount`/`chunkOffsets` safe to treat as authoritative. Rejects lock-free last-writer-wins (silently lost appends, offset-index drift).

## Constants

| Name | Value | Purpose |
|---|---|---|
| `CHUNK_MAX_BYTES` | ~16 MB | Byte cap per JSONL chunk; rolls over when the next row would exceed it (oversized single row still gets its own chunk). Only hard chunk bound in v1; row-count ceiling deferred to the reads epic. |
| Chunk key format | `datasets/{projectId}/{datasetId}/chunk-{NNNNN}.jsonl` | Ordered, zero-padded, tenant-prefixed. PG-authoritative; LIST is repair-only. |
| Staging key format | `staging/{projectId}/{uploadId}` + bucket lifecycle TTL | Server-owned upload target; lifecycle rule reaps orphaned un-finalized uploads. |
| `UPLOAD_MAX_BYTES` | TBD | Hard size cap — enforced by the presign POST-policy and a fast reject in normalize. |
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
| I-SELFHOST | Self-hosted without storage keeps serving from PG; boot succeeds; migration no-ops. | Boot with no S3 → no crash; PG reads/writes work. |

## Schema

```prisma
model Dataset {
  // ...existing: id, projectId, name, slug, columnTypes, mapping, createdAt, updatedAt, archivedAt
  // useS3 left UNTOUCHED (dead single-blob path) — the new layout uses contentLayout so old pods don't misroute
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

**Positive.** Multi-GB datasets become uploadable; Postgres is unburdened of bulk content; the upload no longer parses in-browser; versioning and billing seams are in place (per-chunk objects + `sizeBytes`); the async path uses the GroupQueue substrate, not BullMQ; worker-death and concurrency are handled, not assumed.

**Negative.**
- A PG-only domain schedules work on GroupQueue via the `registerJob` escape hatch — a conscious exception to event-driven.
- **Reads are not fixed by this epic** — the 5 MB run-time truncation persists, so uploaded multi-GB data is only partially consumed by runs until the batched-reads fast-follow.
- Uploads gain an async `processing` lifecycle that every read consumer must gate on.
- Presigned upload needs bucket CORS + a POST-policy; self-hosted needs browser-reachable S3/MinIO or the backend fallback.
- A staging-prefix lifecycle rule is required or orphaned un-finalized uploads accumulate.
- `DatasetRecord` lingers in PG until the deferred drop migration.

**Neutral.** `useS3` is left for the dead path; `contentLayout` drives the new layout; datasets gain a status lifecycle; reads use chunks only when `contentLayout='s3_jsonl'`.

## Open questions

- **Batched/streaming dataset reads** — the immediate fast-follow epic.
- **`UPLOAD_MAX_BYTES`** — pick a concrete value before implementation.
- **Automatic re-drive** (poll-triggered, no scheduler) and the **`.withOutbox` migration** — optional later hardening; v1 ships manual retry only.
- **Chunk row-count ceiling** — value deferred to the reads epic; v1's only hard bound is the ~16 MB byte cap (Decision 2). (Self-hosted migration trigger resolved in Decision 7 — Helm hook Job.)
- **Presign POST-policy vs PUT** — confirm `createPresignedPost` (new dep `@aws-sdk/s3-presigned-post`) for the size cap.
- **BYOC route** — decommission the dead `useCustomS3` DB route or wire `DATAPLANE_S3__`; deferred, resolver seam keeps it additive.
- **S3-native versioning** & **storage billing** — designed-for, deferred (`sizeBytes` captured now).
- **Drop-`DatasetRecord` migration** — separate, gated on confirmed full cutover.

## Revisions

- **v1 (2026-06-17)** — initial decision. Forks: chunk addressing → ordered S3 keys + PG counters; edit/delete → rewrite affected chunk; upload path → always direct-to-S3; normalize runner → GroupQueue standalone job; status → PG `Dataset.status`; migration → flip-all-at-once. BYOC deferred.
- **v2 (2026-06-17) — red-team fold.** Migration moved off the boot path, per-dataset advisory lock added, `contentLayout` replaces the `useS3` overload (D7). Presign key made server-owned + scoped + size-capped via POST-policy (D4). Advisory lock serializes all chunk mutations (D9). Status-gating extended to all read consumers (D6). Counters made PG-authoritative. The 5 MB read truncation acknowledged as out of scope, batched reads are the immediate fast-follow. Worker-death recovery flagged on the GroupQueue runner (D5).
- **v4 (2026-06-17).** Dropped the standalone re-drive sweeper. Recovery floor = the streaming/memory contract (interruption is rare) + **manual retry** (a stuck `processing` dataset is always re-runnable; PG rows + staging file intact, nothing lost). Poll-triggered re-drive and `.withOutbox` are optional later hardening, not in v1. Keeps the runner pure Postgres + S3 — no ClickHouse, no scheduler.
- **v5 (2026-06-17).** Chunk byte cap **~100 MB → ~16 MB** (D2) — 100 MB over-reads for the future paginated UI; a fixed row cap is rejected (object explosion on light rows), row-count ceiling deferred to the reads epic. Self-hosted migration trigger → **Helm `post-install,post-upgrade` hook Job** (D7), idempotent self-skip. **CodeRabbit fold:** D7 clarified — the flip is rollout-gated (Job/hook runs post-deploy, no old pods at flip), reconciling the PG-fallback wording with S3-as-sole-store; net-new-mid-rollout invisibility accepted as transient (dual-write explicitly rejected). Code (rung 2): `getChunkObject` now **throws on a missing chunk** instead of returning "" (was silent read truncation); `catch` blocks use `unknown` + type guards.
