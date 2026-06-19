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
export type MigrateOutcome = "migrated" | "already-migrated" | "would-migrate";

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
