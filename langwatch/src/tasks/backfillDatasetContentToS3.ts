/**
 * ADR-032 Decision 7 (rung 5): the PG→S3 backfill migration.
 *
 * Flips existing datasets whose content still lives in Postgres
 * (`contentLayout='postgres'`, one `DatasetRecord` row per entry) onto the new
 * chunked-JSONL S3 layout (`contentLayout='s3_jsonl'`), in place, without ever
 * touching the read/write paths from R6.
 *
 * It runs off the `set -e` boot path (a standalone `pnpm run task`, a cloud k8s
 * Job, or the self-hosted Helm `post-install,post-upgrade` hook Job — never in
 * `start.sh`), and is safe to fire on every upgrade because it self-skips when:
 *   - `SKIP_DATASET_S3_MIGRATE` is set (global opt-out), or
 *   - no datasets remain on `contentLayout='postgres'`.
 * Each dataset migrates to whatever backend the resolver provides: S3 when
 * configured, otherwise the local filesystem (`LocalDatasetStorage`). The
 * resolver always returns a backend, so there is no "no storage" skip — a
 * self-hosted no-S3 install backfills to its local path, which must be a
 * persistent volume (else a restart loses chunks the row now points to).
 *
 * Idempotency + resume (I-MIG / I-IDEM):
 *   - The loop paginates `postgres` datasets by id and, for EACH, re-reads the
 *     row inside the per-dataset advisory lock (Decision 9) — if it is no longer
 *     `postgres` (another pod/run already migrated it) it is skipped.
 *   - The S3 chunk write happens BEFORE the PG flip and writes from index 0 with
 *     deterministic keys, so a crash between the S3 write and the PG flip is
 *     recoverable: the next run re-writes the same chunk keys (overwrite by key,
 *     not append) and re-flips. The counter update + `contentLayout` flip happen
 *     in the SAME locked transaction as the lock acquisition, so they commit (or
 *     roll back) as one unit — a dataset is observed either fully `postgres` or
 *     fully `s3_jsonl`, never half-flipped.
 *
 * Non-destructive (I-MIG): the `DatasetRecord` PG rows are deliberately NOT
 * deleted here — they remain as the old-pod read fallback and rollback safety
 * during the rollout window. A SEPARATE later cleanup task drops them once the
 * cutover is confirmed (Decision 7 — "Drop-`DatasetRecord` migration", a
 * follow-up, not this rung).
 */
import { type Dataset, Prisma, type PrismaClient } from "@prisma/client";
import { StreamingChunkWriter } from "../server/datasets/dataset-chunk-writer";
import { withDatasetLock } from "../server/datasets/dataset-lock";
import { DatasetRecordRepository } from "../server/datasets/dataset-record.repository";
import {
  type DatasetStorage,
  getDatasetStorage,
} from "../server/datasets/dataset-storage";
import { prisma } from "../server/db";
import { resolveProjectStorageDestination } from "../server/stored-objects/project-storage-destination";
import { createLogger } from "../utils/logger/server";

const logger = createLogger("langwatch:tasks:backfillDatasetContentToS3");

/** How many `postgres` datasets to fetch per page when iterating. */
const PAGE_SIZE = 50;

/**
 * How many `DatasetRecord` rows to pull per page when streaming ONE dataset into
 * chunks. Bounds peak memory to ~one page + one in-flight chunk, independent of
 * dataset size — the OOM guard for the multi-GB / million-row outliers in prod.
 */
const MIGRATE_PAGE_SIZE = 1000;

/**
 * True when a Prisma error means a column this task queries (`contentLayout` /
 * the chunk-layout columns) doesn't exist in the DB yet — i.e. the schema
 * migration hasn't run. P2022 = "the column `X` does not exist in the current
 * database."
 *
 * This hook Job races the app-boot migration: on `helm upgrade` the
 * post-upgrade hook can fire before the new app pod has applied the migration
 * that adds `contentLayout`. We self-skip cleanly (exit 0) instead of throwing
 * — a thrown error fails the Helm release; the migration will land and the next
 * run (every upgrade re-fires this idempotent task) does the backfill.
 */
const isMissingColumnError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2022";

/** Outcome of attempting to migrate one dataset (for structured counts). */
export type MigrateOutcome =
  | "migrated"
  | "already-migrated"
  | "would-migrate"
  | "skipped-concurrent-write";

/**
 * Boundaries the per-dataset migrate logic depends on. Injected so the core can
 * be unit-tested with stubbed prisma / storage / repository (the real wiring is
 * supplied by {@link execute}).
 */
export type BackfillDeps = {
  prisma: PrismaClient;
  recordRepository: DatasetRecordRepository;
  /** Resolve a project's storage destination — used to detect S3 is configured. */
  resolveStorage: (
    projectId: string,
  ) => ReturnType<typeof resolveProjectStorageDestination>;
  /** Get the dataset storage backend for a project (the S3 chunk writer). */
  getStorage: (projectId: string) => Promise<DatasetStorage>;
};

/**
 * Migrate ONE dataset's content from PG to S3 under the per-dataset advisory
 * lock. Returns the outcome so the caller can tally counts.
 *
 * Ordering (documented in the file header): resolve storage → read PG rows →
 * write S3 chunks → (inside the lock) re-read, flip counters + `contentLayout`.
 * The S3 write precedes the locked PG flip so a crash in between is re-runnable;
 * the flip is atomic within the lock's transaction.
 */
export const migrateDatasetToS3 = async (
  {
    dataset,
    projectId,
  }: {
    dataset: Pick<Dataset, "id" | "projectId" | "contentLayout" | "status">;
    projectId: string;
  },
  deps: BackfillDeps,
  options: { dryRun?: boolean } = {},
): Promise<MigrateOutcome> => {
  // Migrate to whatever storage the resolver provides — S3 when configured,
  // otherwise the local filesystem (LocalDatasetStorage fully supports chunked
  // JSONL). The resolver always returns a backend, so there is no "no storage"
  // skip; a self-hosted no-S3 install backfills to its local path (which must
  // be a persistent volume, else a restart loses chunks the row now points to).
  // Resolved before the lock (no serialization needed) for the log line only.
  const destination = await deps.resolveStorage(projectId);
  if (options.dryRun) {
    // Read-only: resolve the target backend and report, but take no lock, write
    // no chunks, and never flip `contentLayout`.
    logger.info(
      { datasetId: dataset.id, projectId, backend: destination.kind },
      "[dry-run] would migrate dataset content to chunked JSONL — no changes written",
    );
    return "would-migrate";
  }
  logger.info(
    { datasetId: dataset.id, projectId, backend: destination.kind },
    "Migrating dataset content to chunked JSONL",
  );

  const storage = await deps.getStorage(projectId);

  // Pre-check OUTSIDE the lock: skip an already-migrated dataset before doing any
  // S3 work. The authoritative re-check runs inside the lock below — this one
  // just avoids wasted writes on the common already-done case.
  const preCheck = await deps.prisma.dataset.findFirst({
    where: { id: dataset.id, projectId },
  });
  if (!preCheck || preCheck.contentLayout !== "postgres") {
    logger.info(
      { datasetId: dataset.id, projectId },
      "Skipping dataset — already migrated (not on postgres layout)",
    );
    return "already-migrated";
  }
  // Defense-in-depth (the dataset query already filters `useS3: false`): a legacy
  // single-blob `useS3` dataset stores its rows in ONE S3 object, NOT as
  // `DatasetRecord` rows — reading through `findDatasetRecordsPage` would yield
  // ZERO rows and flip it to an EMPTY `s3_jsonl` dataset, silently destroying the
  // blob's content. The legacy `useS3` read path is still live (see
  // `datasetRecord.ts`), so leave these on it untouched (schema migration:
  // "`useS3` left untouched"). A finite, closed legacy set — no new ones are minted.
  if (preCheck.useS3) {
    logger.info(
      { datasetId: dataset.id, projectId },
      "Skipping dataset — legacy useS3 single-blob layout (left on the legacy path, not flipped to empty s3_jsonl)",
    );
    return "already-migrated";
  }

  // Read the PG rows and write the S3 chunks OUTSIDE the advisory lock — only the
  // atomic counter+`contentLayout` flip needs serialization, so we never hold the
  // lock (and burn its 120s transaction budget) across S3 network I/O. Safe
  // because the write is idempotent by deterministic key: a concurrent/re-run
  // write overwrites the same keys with identical content (a postgres-layout
  // dataset's corpus is frozen during migration) and a crash here is re-runnable.
  //
  // STREAM, don't slurp (I-MEM): keyset-paginate the records and feed them to the
  // StreamingChunkWriter, which rolls a chunk at CHUNK_MAX_BYTES — so peak memory
  // is one page + one chunk, NOT the whole dataset. Prod has multi-GB / million-
  // row datasets (a 708 MB / 57k-row and a 1.6M-row one) that would OOM the Job
  // if read whole; the legacy 25MB/10k upload cap does NOT bound pre-existing or
  // API-created data. The page order matches `findDatasetRecords` so re-runs
  // produce identical chunks (crash-resume), and each row's id is PRESERVED so
  // the chunk lines carry the same record ids the editor targets (I-MIG).
  // Concurrent-write guard baseline (I-MIG): snapshot the record count + latest
  // updatedAt BEFORE streaming the rows. We re-read both under the lock just
  // before the flip; any change means a write landed during the snapshot→flip
  // window (count → insert/delete; maxUpdatedAt → same-count content edit), so
  // we skip the flip rather than freeze a stale snapshot into chunks. Honest
  // scope: a one-off off-peak MITIGATION, not a proof — the PG write paths don't
  // take this lock, so a write in the narrow re-read→commit window is still
  // missed. Off-peak that window is effectively empty.
  const baseline = await deps.recordRepository.countAndMaxUpdatedAt({
    datasetId: dataset.id,
    projectId,
  });

  const writer = new StreamingChunkWriter({
    storage,
    projectId,
    datasetId: dataset.id,
  });
  let cursorId: string | undefined;
  for (;;) {
    const page = await deps.recordRepository.findDatasetRecordsPage({
      datasetId: dataset.id,
      projectId,
      take: MIGRATE_PAGE_SIZE,
      cursorId,
    });
    if (page.length === 0) break;
    for (const row of page) {
      await writer.push(row.entry, { id: row.id });
    }
    cursorId = page[page.length - 1]!.id;
  }
  const meta = await writer.finalize();

  // Defensive orphan-chunk cleanup (I-IDEM): drop any tail chunks a crashed prior
  // run wrote beyond what THIS run writes, so a shorter re-run never leaves
  // dangling `chunk-{n}` objects. Harmless today (frozen corpus → same count) and
  // cheap (stops at the first contiguous gap).
  await storage.deleteChunksFrom({
    projectId,
    datasetId: dataset.id,
    fromIndex: meta.chunkCount,
  });

  // Flip onto s3_jsonl UNDER the lock — a short, PG-only critical section: re-read
  // to win the race against a concurrent run (our idempotent S3 writes make a
  // redundant write harmless), then commit the counter update + `contentLayout`
  // flip atomically. `status` is left untouched (existing datasets are `ready`).
  return withDatasetLock(
    { prisma: deps.prisma, datasetId: dataset.id },
    async (tx) => {
      const current = await tx.dataset.findFirst({
        where: { id: dataset.id, projectId },
      });
      if (!current || current.contentLayout !== "postgres") {
        logger.info(
          { datasetId: dataset.id, projectId },
          "Skipping dataset — already migrated (not on postgres layout)",
        );
        return "already-migrated";
      }

      // Concurrent-write guard (I-MIG): re-read count + maxUpdatedAt inside the
      // flip transaction and compare to the pre-read baseline. A mismatch means
      // a record was inserted/deleted/edited during the snapshot→flip window —
      // the chunks we wrote are stale, so DO NOT flip. The dataset stays on
      // `postgres` (fully readable from PG, non-destructive) and the next run
      // re-migrates it from a fresh snapshot. Never flips a stale snapshot live.
      const recheck = await deps.recordRepository.countAndMaxUpdatedAt(
        { datasetId: dataset.id, projectId },
        { tx },
      );
      if (
        recheck.count !== baseline.count ||
        recheck.maxUpdatedAt?.getTime() !== baseline.maxUpdatedAt?.getTime()
      ) {
        logger.warn(
          {
            datasetId: dataset.id,
            projectId,
            baselineCount: baseline.count,
            recheckCount: recheck.count,
          },
          "Skipping flip — records changed during migration (concurrent write); will re-migrate on the next run",
        );
        return "skipped-concurrent-write";
      }

      await tx.dataset.update({
        where: { id: dataset.id, projectId },
        data: {
          rowCount: meta.rowCount,
          sizeBytes: BigInt(meta.sizeBytes),
          chunkCount: meta.chunkCount,
          chunkOffsets: meta.chunkOffsets,
          contentLayout: "s3_jsonl",
        },
      });

      // NON-DESTRUCTIVE (I-MIG): the `DatasetRecord` PG rows are intentionally
      // left in place as old-pod read fallback / rollback safety. A SEPARATE
      // later cleanup task removes them once the rollout is confirmed.
      logger.info(
        {
          datasetId: dataset.id,
          projectId,
          rowCount: meta.rowCount,
          chunkCount: meta.chunkCount,
          sizeBytes: meta.sizeBytes,
        },
        "Migrated dataset content to chunked JSONL (s3_jsonl)",
      );
      return "migrated";
    },
  );
};

/** Running tally of per-dataset outcomes. */
export type BackfillSummary = {
  migrated: number;
  /** Dry-run only: datasets that WOULD be migrated (nothing was written). */
  wouldMigrate: number;
  alreadyMigrated: number;
  /**
   * Datasets whose flip was skipped because records changed mid-migration
   * (concurrent-write guard). Non-zero ⟹ re-run the backfill to drain them —
   * they are still on `postgres` and fully readable, nothing was lost.
   */
  skippedConcurrentWrite: number;
  failed: number;
};

/**
 * Iterate every `contentLayout='postgres'` dataset (paginated by id — never
 * loading all at once) and migrate each under the advisory lock. A per-dataset
 * failure is logged and counted but does not abort the run (the next run
 * re-attempts it — idempotent). Returns the summary counts.
 */
export const migrateAllPostgresDatasets = async (
  deps: BackfillDeps,
  options: { dryRun?: boolean } = {},
): Promise<BackfillSummary> => {
  const summary: BackfillSummary = {
    migrated: 0,
    wouldMigrate: 0,
    alreadyMigrated: 0,
    skippedConcurrentWrite: 0,
    failed: 0,
  };

  // `Project` is a GLOBAL_MODEL (exempt from the projectId guard), so list every
  // project, then scan each project's `postgres` datasets WITH `projectId` — the
  // multitenancy middleware requires it on model-level queries (a bare
  // cross-tenant Dataset query is rejected by design). Mirrors the cross-tenant
  // walk in `migrateCustomModels`.
  const projects = await deps.prisma.project.findMany({ select: { id: true } });

  for (const project of projects) {
    let cursor: string | undefined;
    for (;;) {
      const page = await deps.prisma.dataset.findMany({
        where: {
          projectId: project.id,
          contentLayout: "postgres",
          // Exclude legacy single-blob `useS3` datasets: their rows live in one
          // S3 object, not as `DatasetRecord` rows, so the backfill would read
          // zero and flip them to an EMPTY s3_jsonl dataset (data loss). They
          // stay on the still-live legacy read path. See the guard in
          // `migrateDatasetToS3` for the per-dataset rationale.
          useS3: false,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: {
          id: true,
          projectId: true,
          contentLayout: true,
          status: true,
        },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
      });
      if (page.length === 0) break;

      for (const dataset of page) {
        try {
          const outcome = await migrateDatasetToS3(
            { dataset, projectId: dataset.projectId },
            deps,
            options,
          );
          if (outcome === "migrated") summary.migrated += 1;
          else if (outcome === "would-migrate") summary.wouldMigrate += 1;
          else if (outcome === "skipped-concurrent-write")
            summary.skippedConcurrentWrite += 1;
          else summary.alreadyMigrated += 1;
        } catch (error) {
          summary.failed += 1;
          logger.error(
            { error, datasetId: dataset.id, projectId: dataset.projectId },
            "Failed to migrate dataset to S3 — will retry on the next run",
          );
        }
      }

      cursor = page[page.length - 1]!.id;
    }
  }

  return summary;
};

/**
 * Task entrypoint — wired to the real prisma client, record repository and
 * storage accessors. Run via `pnpm run task backfillDatasetContentToS3`
 * (alias: `pnpm run task:backfill-datasets-s3`), the cloud k8s Job, or the
 * self-hosted Helm post-install/post-upgrade hook Job.
 *
 * Global self-skip: `SKIP_DATASET_S3_MIGRATE` truthy → log + return early
 * (the task runner exits 0).
 */
export default async function execute(): Promise<void> {
  if (process.env.SKIP_DATASET_S3_MIGRATE) {
    logger.info(
      "SKIP_DATASET_S3_MIGRATE is set — skipping PG→S3 dataset backfill",
    );
    return;
  }

  const deps: BackfillDeps = {
    prisma,
    recordRepository: new DatasetRecordRepository(prisma),
    resolveStorage: resolveProjectStorageDestination,
    getStorage: getDatasetStorage,
  };

  // Dry-run: report what WOULD migrate (and to which backend) without taking a
  // lock, writing chunks, or flipping `contentLayout`. Via env or CLI flag:
  //   DATASET_S3_MIGRATE_DRY_RUN=1 pnpm run task backfillDatasetContentToS3
  //   pnpm run task backfillDatasetContentToS3 --dry-run
  const dryRun =
    !!process.env.DATASET_S3_MIGRATE_DRY_RUN ||
    process.argv.includes("--dry-run");

  logger.info(
    { dryRun },
    dryRun
      ? "Starting PG→S3 dataset content backfill (DRY RUN — no changes will be written)"
      : "Starting PG→S3 dataset content backfill",
  );
  try {
    const summary = await migrateAllPostgresDatasets(deps, { dryRun });
    logger.info(
      { ...summary, dryRun },
      dryRun
        ? "Finished PG→S3 dataset content backfill (DRY RUN — nothing written)"
        : "Finished PG→S3 dataset content backfill",
    );
  } catch (error) {
    // Hook/schema race: the post-upgrade hook can run before the app pod's
    // migration adds `contentLayout`. Self-skip (exit 0) so the Helm release
    // doesn't fail; the idempotent task re-runs on the next upgrade once the
    // column exists.
    if (isMissingColumnError(error)) {
      logger.info(
        "Dataset chunk-layout columns not present yet (schema migration pending) — skipping backfill; it will run on the next upgrade",
      );
      return;
    }
    throw error;
  }
}
