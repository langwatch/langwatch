# ADR-034: Live dataset-processing progress is broadcast-only over the export SSE spine, with getById as the terminal authority

**Date:** 2026-06-30

**Status:** Accepted

> **One-line:** A large dataset's normalize job **broadcasts ephemeral progress** (input-`bytesRead` / `totalBytes` / `rows` / `phase`) over the **existing export `BroadcastService` → tRPC SSE** spine on a producer-side throttle; the client renders a **bytes-%, live-row-count, client-computed-ETA bar with a phase stepper**, takes the **%** purely from SSE but treats **`getById` as the durable terminal authority** (re-fetched on connect / on `done` / on SSE-gap), **writes no progress to Postgres**, and **adds no schema** — so the bar can never hang and never overshoot, at the deliberate cost that the exact in-flight % does not survive a refresh.

## Context

A customer onboarding a multi-GB dataset hits a **multi-minute "Processing"** with zero feedback (`BulkUploadDrawer` "Preparing…" spinner; `[id].tsx` "Preparing your dataset" alert). It reads as hung. **Forcing function:** large-dataset onboarding friction — the silent wait is the felt pain.

**Blast radius: data-path adjacent.** The progress producer is the normalize worker, so this ADR carries invariants + a mandatory red-team (folded as v2), even though it ships no migration.

This builds directly on **ADR-032** (`dev/docs/adr/032-datasets-s3-jsonl.md`, Accepted), which provides everything durable we need and which this ADR does **not** revise:

- Normalize runs **off-request as a standalone GroupQueue job** (`registerJob`, concurrency 1, streaming, memory-bounded), reading the staged upload and producing ~16 MB JSONL chunks via `StreamingChunkWriter`.
- The `Dataset` row carries durable **terminal** state: `status` (`uploading → processing → ready / failed`), `statusError`, and **on success** `rowCount` / `sizeBytes` / `chunkCount` / `chunkOffsets`. The staged object is HEAD'd for its **raw input size** at finalize.
- Every read consumer gates on `status='ready'` (I-READY); a wedged `processing` row is re-driven by the poll-triggered `reapStaleProcessing` (ADR-032 v17).

And on the **export progress** spine, reused in shape — with its real limits now understood (see v2):

- `BroadcastService.broadcastToTenant` / `broadcastToTenantRateLimited` / `getTenantEmitter` — Redis pub/sub, multi-pod-safe (`src/server/app-layer/broadcast/broadcast.service.ts`). The rate limiter (`tenant-rate-limiter.ts:75`) is a **token bucket that DROPS** over-budget events — it does **not** coalesce — and a subscriber-side bucket gates **every** inbound message (`broadcast.service.ts:89`). Subscriptions relay **live** emitter events only; **there is no replay/last-value cache**.
- `exportRouter.onExportProgress` — a tRPC SSE `subscription` filtered by id, terminating on `done`/`error` (`src/server/api/routers/export.ts`). The template for `onDatasetProgress`. Export survives the no-replay/drop gaps **only because its subscription is welded to the HTTP streaming response**; ADR-034 decouples the worker job from the subscription, so it must reconcile terminals itself.

**What is missing** is only the *signal*: GroupQueue is a fire-and-forget FIFO one-shot (`queueManager.ts:678`) with **no `updateProgress`, no durable, queryable job-progress store**.

**Prior ADRs / rules.** ADR-019 + `CLAUDE.md`: route → service → repository, `projectId` on every query. ADR-007/023/026: GroupQueue is the substrate (no BullMQ). Reuse over parallel-build — honored by extending the export spine.

## Decision

1. **In-flight progress is broadcast-only and ephemeral — never written to Postgres.** The normalize job emits a progress event over the existing `BroadcastService`; nothing about the running % touches the `Dataset` row. **Rejects** persisting progress to new `Dataset` columns or a `DatasetProcessing` table (~128 `UPDATE`s per 2 GB file — write-amplification on the heaviest path, for durability we trade away in Decision 6) and "reuse a GroupQueue progress store" (none exists).

2. **The denominator is input bytes; rows and ETA are derived.** `% = bytesRead / totalBytes`, where **`bytesRead` is bytes consumed from the staged input stream** and **`totalBytes` is the staged-object HEAD size captured at job start** — both measured on the **input** side, deliberately *not* the output `sizeBytes` column (which is normalized-chunk bytes written only on success, and would make the bar overshoot/undershoot — see I-BYTES). `rows` is an **unbounded live count**, no denominator. **ETA/throughput are computed client-side** from successive SSE deltas (Δbytes / Δt), shown only after ≥2 deltas. Determinate from the first tick, **single pass**. **Rejects** a row-count denominator via line-count pre-pass (doubles I/O, violates ADR-032's streaming contract) and an indeterminate-only bar.

3. **Transport reuses the export spine as a single tenant-scoped `onDatasetProgress` tRPC SSE subscription, client-filtered by a watched `datasetId` set.** One subscription per project; the detail page watches one id, the bulk drawer watches N — one code path, scales to bulk on a single emitter listener. `datasets:view` RBAC, server-side tenant scoping, terminates when no watched id remains active. **Rejects** a per-dataset subscription (N concurrent uploads = N listeners against the per-tenant emitter's shared 50-listener ceiling — `broadcast.service.ts:258` — `MaxListenersExceeded` + leak on a 50-file drop) and keeping the 3 s `getById` poll as the primary channel.

4. **The client takes the % purely from SSE but treats `getById` as the durable terminal authority.** `getById` is re-fetched/invalidated on **subscription connect**, on **receipt of `done`/`error`**, and on **any SSE gap > `DATASET_PROGRESS_STALE_RECONCILE_MS` while `processing`**. A durable `ready`/`failed` from `getById` drives the bar terminal **regardless of whether the terminal SSE event ever arrived**. This is **not** the rejected 3 s poll — it is event-driven refetch plus one safety timer. **Rejects** a one-shot `getById` mount-seed with no reconciliation (the common subscribe-after-done race — fast job finishes before the component subscribes — leaves the bar hung forever).

5. **The terminal `done`/`error` is sent via plain `broadcastToTenant` (never the rate-limited path) and only *after* the durable terminal commit.** The rate limiter drops; the terminal event must not be droppable, and committing `status` before broadcasting prevents a `done`-triggered `getById` refetch from racing back to `processing`. Even so, delivery is best-effort — Decision 4's reconciliation is the guarantee; this just makes the happy path instant. **Rejects** routing the terminal through `broadcastToTenantRateLimited` (could be dropped under tenant bucket pressure, stranding the bar at 99%).

6. **On refresh / SSE-drop mid-job the bar is indeterminate and self-heals; terminal correctness is guaranteed by Decision 4, not by "the next delta."** `getById='processing'` → indeterminate "Processing…"; the next throttled broadcast refills the exact % while the worker is alive; a dead/wedged worker stays **honestly indeterminate** (the UI never invents a %) until `getById` reconciliation or ADR-032's `reapStaleProcessing` resolves it. **Rejects** subscribe-triggered worker re-emit (extra machinery for a sub-second gain) and a blank/0 % hold.

7. **The Phase-1 "durable / refresh-proof" constraint is consciously downgraded — for the % only.** Only **terminal** state (`status` / `statusError` / final counts — already durable per ADR-032) survives a refresh; the **intermediate %** does not. This is the price of Decision 1, accepted because (a) the bar self-heals within one throttle interval while the worker is alive and (b) Decision 4 guarantees the terminal is always reached.

8. **A rich phase stepper rides inside the SSE payload — no new column.** `Uploading → Processing (%) → Finalizing → Ready/Failed`; the fine `phase` travels in the event, the coarse refresh-seed uses ADR-032's `status`. **Rejects** a persisted `phase` column and a single bar with no stepper.

9. **Failures surface generically via ADR-032's durable `statusError` — no line/row location.** `status='failed'` + a generic message, durable on the row, read by the `getById` reconciliation (Decision 4), shown with Retry. **Rejects** enriching `statusError` with the offending line (deferred — minimal v1) and streaming the error only over SSE (a refresh after failure would lose it).

10. **The `runInline` (no-worker) large-file hazard is out of scope for this ADR.** It is an ADR-032 concern (its Accepted I-SELFHOST promises no-worker installs onboard multi-GB datasets inline) and the real hazard is **event-loop starvation**, not heap OOM (ADR-032's streaming contract already bounds memory). Handling it correctly — a **setup-time** "configure a worker/Redis for large uploads" error rather than a per-upload ambush — requires amending ADR-032, tracked as an Open Question. **Rejects** folding a per-upload inline byte-reject into ADR-034 (would bury a regression of an Accepted invariant inside a UX ADR, mis-frame the hazard as OOM, and collide numerically with `LARGE_JSON_MAX_BYTES`).

## Constants

| Name | Value | Purpose |
|---|---|---|
| Broadcast event type | `"dataset_progress"` | Tenant-emitter event name; **must** be added to `BroadcastEventType` + `ALL_EVENT_TYPES` (`broadcast.service.ts:22`) or delivery is silently same-pod-only (I-XPOD). |
| `phase` values | `uploading` \| `processing` \| `finalizing` \| `ready` \| `failed` | Fine stepper state in the SSE event (ephemeral); coarse refresh-seed maps from `Dataset.status`. |
| Event `type` values | `progress` \| `done` \| `error` | Mirrors `exportProgressEventSchema`; subscription drops a watched id on its `done`/`error`. |
| `DATASET_PROGRESS_BROADCAST_MIN_INTERVAL_MS` | 1000 (proposed, tunable) | **Producer-side** min-interval throttle (last-sent timestamp) — the token-bucket limiter does **not** enforce an interval (S5), so the producer must. `progress` events are throttled; **terminal events bypass it.** |
| `DATASET_PROGRESS_STALE_RECONCILE_MS` | 5000 (proposed, tunable) | SSE-gap after which the client re-fetches `getById` while `processing` (Decision 4 safety timer). |
| Subscription RBAC | `datasets:view` | Gate on `onDatasetProgress` (mirrors export's `traces:view`). |
| `bytesRead` / `totalBytes` | input stream offset / staging HEAD at job start | Both input-side; never the output `sizeBytes` column (B2 / I-BYTES). |

## Invariants

| ID | Invariant | Test anchor |
|---|---|---|
| I-NOWRITE | The progress path performs **zero** `Dataset` writes during normalize; the only writes are ADR-032's claim (`processing`) and the single terminal update (`ready`/`failed`). | Normalize a large file → assert no `Dataset` UPDATE between claim and finalize beyond the terminal one. |
| I-TERMINAL-REACHED | The bar **always** reaches a terminal state even if **every** SSE event is dropped or the subscription starts after the job finished — `getById` reconciliation (connect / `done` / gap) flips it. | Subscribe after the job already emitted `done`; drop all SSE → `getById` refetch flips bar to ready/failed, no hang. |
| I-BYTES | The bar is monotonic in [0, 100] and reaches 100 only at finalize — numerator and denominator are both input-side. | Normalize an expanding CSV (JSONL ≫ raw) and a compressing one → never exceeds 100% early, never teleports. |
| I-ORDER | Terminal `status` is committed **before** the terminal broadcast; a `done`-triggered `getById` refetch never observes `processing`. | Broadcast-after-commit ordering test; `done` → refetch returns `ready`. |
| I-XPOD | With the worker on pod A and the subscription on pod B, progress crosses pods (event type registered in `ALL_EVENT_TYPES`). | Publish on A, subscribe on B → event received. |
| I-TENANT | Progress is tenant-scoped and client-filtered by `datasetId`; a subscriber never receives another project's progress; gated by `datasets:view`. | Cross-project subscribe → zero leak. |
| I-RATE | Producer emits at most one `progress` event per `DATASET_PROGRESS_BROADCAST_MIN_INTERVAL_MS` regardless of chunk count; terminal events are exempt. | Normalize a 2 GB file → `progress` event count ≈ duration/interval, not one-per-chunk; exactly one terminal. |
| I-TERMINAL-DURABLE | `ready`/`failed` + final counts + `statusError` survive a refresh (inherits ADR-032 I-READY). | Fail a normalize → refresh → still `failed` + message + Retry. |

## Schema

**No migration. Intentionally.** Every durable field already exists on `Dataset` from ADR-032. The only new declared shape is the SSE event, parallel to `exportProgressEventSchema`:

```ts
// src/server/api/routers/dataset.ts (new subscription, mirrors export.ts)
export const datasetProgressEventSchema = z.object({
  datasetId: z.string(),
  type: z.enum(["progress", "done", "error"]),
  phase: z
    .enum(["uploading", "processing", "finalizing", "ready", "failed"])
    .optional(),
  bytesRead: z.number().optional(),  // input stream offset (numerator)
  totalBytes: z.number().optional(), // staging-object HEAD size @ job start (NOT Dataset.sizeBytes)
  rows: z.number().optional(),       // unbounded live count, no denominator
  message: z.string().optional(),    // generic failure message (Decision 9)
});
```

Producer wiring (no new persistence):

```
dataset-normalize.job.ts
  ├─ at job start: totalBytes = HEAD(stagingKey)           // raw input size
  ├─ parse loop tracks bytesRead from the staged input stream
  ├─ producer throttle (last-sent ts ≥ MIN_INTERVAL_MS):
  │     broadcast.broadcastToTenantRateLimited(projectId,
  │       { datasetId, type:"progress", phase, bytesRead, totalBytes, rows },
  │       "dataset_progress")
  └─ on finalize/catch:
        repository.update(status: ready|failed, ...)        // COMMIT FIRST (I-ORDER)
        broadcast.broadcastToTenant(projectId,              // PLAIN broadcast, after commit (Decision 5)
          { datasetId, type: "done"|"error", phase, message? }, "dataset_progress")
```

Client: tenant-scoped `onDatasetProgress.useSubscription` (filter by watched `datasetId` set) for the % / rows / phase; `api.dataset.getById` invalidated on connect / `done` / SSE-gap for the durable terminal (Decision 4).

## Rejected alternatives

- **Generic job-progress platform** — over-built; datasets is the only consumer.
- **Minimal bar, no ETA/phase** — fails the rich-bar intent.
- **Row-count denominator via pre-pass** — doubles I/O, breaks ADR-032's streaming contract.
- **Output `sizeBytes` as denominator** — doesn't exist mid-job; output/raw mismatch overshoots (B2).
- **Persist progress to columns / a table** — write-amplification; durability traded away.
- **GroupQueue progress store** — none exists; FIFO one-shot only.
- **One-shot `getById` seed, no reconciliation** — subscribe-after-done hangs the bar (B1).
- **Terminal via the rate-limited path** — droppable; strands the bar at 99% (B1).
- **Retained-last-event cache in BroadcastService** — adds stateful TTL/eviction to a shared service export doesn't need; `getById` reconciliation is cheaper and already durable.
- **Per-dataset subscription** — 50-listener ceiling breaks the bulk drop (S3).
- **Keep the 3 s poll primary / poll fallback** — underuses SSE; bulk N-poll cost.
- **Subscribe-triggered worker re-emit** — machinery for a sub-second gain.
- **Durable line-number failure detail** — deferred; generic `failed`.
- **Inline byte-reject inside ADR-034** — wrong ADR, wrong hazard model, number collision (S4 → Decision 10).

## Consequences

**Positive**
- **Zero new schema, zero migration** — additive: one SSE event type + one throttled broadcast + one client component.
- **No DB write-amplification** on the heaviest path.
- **The bar can neither hang nor overshoot** — `getById` reconciliation (I-TERMINAL-REACHED) + input-side bytes (I-BYTES) close the two red-team blockers.
- **Real-time bytes-%, live rows, ETA, phase stepper**; cross-pod by construction; one transport shape scales detail → bulk.

**Negative**
- **Exact in-flight % does not survive a refresh / SSE-drop** — brief indeterminate flash, self-heals only while the worker is alive (Decision 7, conscious).
- **A small `getById` reconciliation cost** returns — event-driven refetch on connect/`done`/gap (not a periodic poll), a deliberate concession to close B1.
- **A wedged/dead worker is indistinguishable from "slow"** until reconciliation / `reapStaleProcessing`.
- **Generic failure message** — a malformed line in a 2 GB file gives no location.
- **The no-worker large-file hazard is left unfixed here** — deferred to an ADR-032 amendment (Open Questions).

**Neutral**
- ETA is a client-side byte-rate estimate (shown after ≥2 deltas); the **rows/sec** display is jumpy on base64-heavy data, the ETA itself is defensible (normalize wall-time tracks bytes-I/O).

## Open questions

- **ADR-032 amendment for the `runInline` large-file hazard** (Decision 10): a setup-time "configure a worker/Redis for large uploads" error, framed as event-loop starvation, narrowing I-SELFHOST as a formal ADR-032 revision. **Owner: TBD — a separate ADR-032 amendment, not blocking this ADR (034).**
- **`DATASET_PROGRESS_BROADCAST_MIN_INTERVAL_MS`** (1000) and **`DATASET_PROGRESS_STALE_RECONCILE_MS`** (5000) — tune against perceived smoothness vs Redis/refetch load once measured.
- **Durable line-number failures** — revisit if support sees users stuck on opaque "failed" (deferred).

## Revisions

- **v1 (2026-06-30):** Initial. Phase-1: decision = dataset-only progress UX, forcing = large-dataset onboarding, blast = data-path adjacent, locked = reuse SSE spine · durable/refresh-proof. Phase-3 r1: bytes denominator; inline minimal-guard; GroupQueue-job-only (no PG); pure-SSE transport. r2: indeterminate-self-heal; rich broadcast-only phases; generic-failed; per-dataset subscription. **"durable/refresh-proof" consciously downgraded** to ephemeral-%/durable-terminal.
- **v2 (2026-06-30) — red-team folded:** **B1** the terminal SSE event is droppable (token-bucket drops, no replay) and subscribe-after-done hangs the bar → **`getById` becomes the event-driven terminal authority** (connect / `done` / gap) + terminal sent via **plain** `broadcastToTenant` after commit (Decisions 4, 5; I-TERMINAL-REACHED). **B2** denominator conflated output `sizeBytes` with raw input → **both numerator and denominator are input-side**, staging HEAD at job start (Decision 2; I-BYTES). **S1** commit `status` before terminal broadcast (I-ORDER). **S2** register `dataset_progress` in `ALL_EVENT_TYPES` or it's same-pod-only (I-XPOD). **S3** per-dataset subscription breaks the 50-listener bulk ceiling → **single tenant-scoped, client-filtered subscription** (Decision 3, supersedes r2 per-dataset keying). **S4** the inline guard regressed Accepted I-SELFHOST and mis-framed the hazard → **removed from 033**, deferred to an ADR-032 amendment (Decision 10). **S5** the limiter is a token bucket, not a min-interval throttle → **producer-side throttle**, terminal exempt (I-RATE).
