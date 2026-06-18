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
 *   - no datasets remain on `contentLayout='postgres'`, or
 *   - a given project has no S3 storage configured (can't migrate to S3 without
 *     S3 — that dataset is LEFT on `postgres` and keeps reading from PG).
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
import type { Dataset, PrismaClient } from "@prisma/client";
import { chunkedMeta } from "../server/datasets/dataset-chunking";
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

/** Outcome of attempting to migrate one dataset (for structured counts). */
export type MigrateOutcome = "migrated" | "already-migrated" | "no-s3";

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
): Promise<MigrateOutcome> => {
  // Can't migrate to S3 without S3 — leave it on `postgres` so it keeps
  // reading from PG (I-SELFHOST). Checked before taking the lock since it
  // needs no serialization.
  const destination = await deps.resolveStorage(projectId);
  if (destination.kind !== "s3") {
    logger.info(
      { datasetId: dataset.id, projectId },
      "Skipping dataset — project has no S3 storage configured, leaving on postgres",
    );
    return "no-s3";
  }

  const storage = await deps.getStorage(projectId);

  return withDatasetLock(
    { prisma: deps.prisma, datasetId: dataset.id },
    async (tx) => {
      // Re-read inside the lock: another pod/run may have migrated this dataset
      // since we listed it. Idempotent/resumable — only `postgres` is migrated.
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

      // Read the PG rows (small — capped at the legacy 25MB/10k limits, so the
      // whole dataset fits in memory; no streaming needed). PRESERVE ids so the
      // s3_jsonl chunk lines carry the same record ids the editor targets.
      const records = await deps.recordRepository.findDatasetRecords(
        { datasetId: dataset.id, projectId },
        { tx },
      );
      const lines = records.map((row) => ({ id: row.id, entry: row.entry }));

      // Write S3 chunks BEFORE the PG flip. Deterministic keys from index 0 →
      // a re-run overwrites the same keys idempotently rather than appending.
      const written = await storage.writeChunks({
        projectId,
        datasetId: dataset.id,
        records: lines,
        fromIndex: 0,
      });

      // Defensive orphan-chunk cleanup (I-IDEM). A crashed prior run could have
      // written MORE chunks than this run does (e.g. if it failed mid-write, or
      // a future change makes the corpus shrinkable) — those tail chunks would
      // be orphaned, since `writeChunks` overwrites by key but never deletes
      // beyond what it writes. Drop everything from `written.length` upward so a
      // shorter re-run can never leave dangling `chunk-{n}` objects. Harmless
      // today (the PG corpus is frozen → re-runs write the same count), but it
      // future-proofs the flow and is cheap (stops at the first contiguous gap).
      // Called unconditionally: simpler than gating on "could there be priors"
      // and the no-op cost (one HEAD that 404s) is negligible.
      await storage.deleteChunksFrom({
        projectId,
        datasetId: dataset.id,
        fromIndex: written.length,
      });
      const meta = chunkedMeta(written);

      // Flip the dataset onto the s3_jsonl layout in the SAME locked
      // transaction — counter update + contentLayout flip commit atomically.
      // `status` is left untouched (existing datasets are `ready`).
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
        "Migrated dataset content to S3 (s3_jsonl)",
      );
      return "migrated";
    },
  );
};

/** Running tally of per-dataset outcomes. */
export type BackfillSummary = {
  migrated: number;
  alreadyMigrated: number;
  noS3: number;
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
): Promise<BackfillSummary> => {
  const summary: BackfillSummary = {
    migrated: 0,
    alreadyMigrated: 0,
    noS3: 0,
    failed: 0,
  };

  let cursor: string | undefined;
  for (;;) {
    const page = await deps.prisma.dataset.findMany({
      where: {
        contentLayout: "postgres",
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, projectId: true, contentLayout: true, status: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
    });
    if (page.length === 0) break;

    for (const dataset of page) {
      try {
        const outcome = await migrateDatasetToS3(
          { dataset, projectId: dataset.projectId },
          deps,
        );
        if (outcome === "migrated") summary.migrated += 1;
        else if (outcome === "already-migrated") summary.alreadyMigrated += 1;
        else summary.noS3 += 1;
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

  logger.info("Starting PG→S3 dataset content backfill");
  const summary = await migrateAllPostgresDatasets(deps);
  logger.info({ ...summary }, "Finished PG→S3 dataset content backfill");
}
