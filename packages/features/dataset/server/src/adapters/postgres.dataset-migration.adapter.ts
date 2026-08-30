import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { DatasetStorageResolver } from "../ports/dataset-storage.port";
import type {
  DatasetMigrationDatabasePort,
  DatasetMigrationFingerprintDatabase,
} from "../ports/dataset-migration-database.port";
import { StreamingChunkWriter } from "../services/dataset-chunk-writer";
import {
  DATASET_MUTATION_TXN_MAX_WAIT_MS,
  DATASET_MUTATION_TXN_TIMEOUT_MS,
} from "../repositories/prisma/dataset-content.repository";

const logger = createLogger("langwatch:dataset:migration");
const DATASET_PAGE_SIZE = 50;
const RECORD_PAGE_SIZE = 1000;

export type DatasetMigrationOutcome =
  | "migrated"
  | "already-migrated"
  | "would-migrate"
  | "skipped-concurrent-write";

export type DatasetMigrationSummary = {
  migrated: number;
  wouldMigrate: number;
  alreadyMigrated: number;
  skippedConcurrentWrite: number;
  failed: number;
};

export type DatasetMigrationRunResult =
  | { status: "completed"; summary: DatasetMigrationSummary }
  | { status: "schema-pending" };

/** Process adapter for the one-off Postgres-to-object-storage migration. */
export class PostgresDatasetMigrationAdapter {
  static create(options: {
    database: DatasetMigrationDatabasePort;
    storage: DatasetStorageResolver;
  }): PostgresDatasetMigrationAdapter {
    return new PostgresDatasetMigrationAdapter(options);
  }

  private constructor(
    private readonly options: {
      database: DatasetMigrationDatabasePort;
      storage: DatasetStorageResolver;
    },
  ) {}

  async run(input: { dryRun?: boolean } = {}): Promise<DatasetMigrationRunResult> {
    try {
      return {
        status: "completed",
        summary: await this.migrateAll(input),
      };
    } catch (error) {
      if (isMissingColumnError(error)) {
        return { status: "schema-pending" };
      }
      throw error;
    }
  }

  async migrateDataset(
    input: { datasetId: string; projectId: string },
    options: { dryRun?: boolean } = {},
  ): Promise<DatasetMigrationOutcome> {
    if (options.dryRun) {
      logger.info(input, "[dry-run] would migrate dataset content to chunked JSONL");
      return "would-migrate";
    }

    const current = await this.options.database.dataset.findFirst({
      where: { id: input.datasetId, projectId: input.projectId },
      select: { contentLayout: true, useS3: true },
    });
    if (current?.contentLayout !== "postgres" || current.useS3) {
      return "already-migrated";
    }

    const baseline = await this.readFingerprint(this.options.database.datasetRecord, input);
    const storage = await this.options.storage.forProject(input.projectId);
    const writer = new StreamingChunkWriter({
      storage,
      projectId: input.projectId,
      datasetId: input.datasetId,
    });

    let cursorId: string | undefined;
    for (;;) {
      const page = await this.options.database.datasetRecord.findMany({
        where: input,
        select: { id: true, entry: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: RECORD_PAGE_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (page.length === 0) break;

      for (const row of page) {
        await writer.push(row.entry, { id: row.id });
      }
      cursorId = page.at(-1)?.id;
    }

    const metadata = await writer.finalize();
    await storage.deleteChunksFrom({
      ...input,
      fromIndex: metadata.chunkCount,
    });

    return this.commitMigration({
      ...input,
      baseline,
      metadata,
    });
  }

  private async commitMigration(input: {
    datasetId: string;
    projectId: string;
    baseline: DatasetFingerprint;
    metadata: DatasetMigrationMetadata;
  }): Promise<DatasetMigrationOutcome> {
    return this.options.database.$transaction(
      async (database) => {
        await database.$executeRaw`-- @tenancy: advisory-lock helper, key is dataset-bounded
SELECT pg_advisory_xact_lock(hashtextextended(${`dataset:${input.datasetId}`}, 0))`;

        const locked = await database.dataset.findFirst({
          where: { id: input.datasetId, projectId: input.projectId },
          select: { contentLayout: true, useS3: true },
        });
        if (locked?.contentLayout !== "postgres" || locked.useS3) {
          return "already-migrated";
        }

        const recheck = await this.readFingerprint(database.datasetRecord, {
          datasetId: input.datasetId,
          projectId: input.projectId,
        });
        const recordSetChanged =
          recheck.count !== input.baseline.count ||
          recheck.maxUpdatedAt?.getTime() !== input.baseline.maxUpdatedAt?.getTime();
        if (recordSetChanged) {
          logger.warn(input, "Dataset records changed during migration; leaving Postgres live");
          return "skipped-concurrent-write";
        }

        await database.dataset.update({
          where: { id: input.datasetId, projectId: input.projectId },
          data: {
            rowCount: input.metadata.rowCount,
            sizeBytes: BigInt(input.metadata.sizeBytes),
            chunkCount: input.metadata.chunkCount,
            chunkOffsets: input.metadata.chunkOffsets,
            contentLayout: "s3_jsonl",
          },
        });

        logger.info(
          {
            datasetId: input.datasetId,
            projectId: input.projectId,
            rowCount: input.metadata.rowCount,
            chunkCount: input.metadata.chunkCount,
            sizeBytes: input.metadata.sizeBytes,
          },
          "Migrated dataset content to chunked JSONL",
        );
        return "migrated";
      },
      {
        timeout: DATASET_MUTATION_TXN_TIMEOUT_MS,
        maxWait: DATASET_MUTATION_TXN_MAX_WAIT_MS,
      },
    );
  }

  private async migrateAll(input: { dryRun?: boolean }): Promise<DatasetMigrationSummary> {
    const summary: DatasetMigrationSummary = {
      migrated: 0,
      wouldMigrate: 0,
      alreadyMigrated: 0,
      skippedConcurrentWrite: 0,
      failed: 0,
    };
    const projects = await this.options.database.project.findMany({
      select: { id: true },
    });

    for (const project of projects) {
      let cursor: string | undefined;
      for (;;) {
        const page = await this.options.database.dataset.findMany({
          where: {
            projectId: project.id,
            contentLayout: "postgres",
            useS3: false,
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          select: { id: true },
          orderBy: { id: "asc" },
          take: DATASET_PAGE_SIZE,
        });
        if (page.length === 0) break;

        for (const dataset of page) {
          try {
            const outcome = await this.migrateDataset(
              { datasetId: dataset.id, projectId: project.id },
              input,
            );
            increment(summary, outcome);
          } catch (error) {
            summary.failed += 1;
            logger.warn(
              { error, datasetId: dataset.id, projectId: project.id },
              "Dataset migration failed; a later run can retry it",
            );
          }
        }

        cursor = page.at(-1)?.id;
      }
    }

    return summary;
  }

  private async readFingerprint(
    records: DatasetMigrationFingerprintDatabase,
    input: { datasetId: string; projectId: string },
  ): Promise<DatasetFingerprint> {
    const result = await records.aggregate({
      where: input,
      _count: { _all: true },
      _max: { updatedAt: true },
    });
    return {
      count: result._count._all,
      maxUpdatedAt: result._max.updatedAt,
    };
  }
}

type DatasetFingerprint = {
  count: number;
  maxUpdatedAt: Date | null;
};

type DatasetMigrationMetadata = {
  rowCount: number;
  sizeBytes: number;
  chunkCount: number;
  chunkOffsets: Array<{
    index: number;
    startRow: number;
    endRow: number;
    byteSize: number;
  }>;
};

function increment(summary: DatasetMigrationSummary, outcome: DatasetMigrationOutcome): void {
  if (outcome === "migrated") summary.migrated += 1;
  if (outcome === "would-migrate") summary.wouldMigrate += 1;
  if (outcome === "already-migrated") summary.alreadyMigrated += 1;
  if (outcome === "skipped-concurrent-write") {
    summary.skippedConcurrentWrite += 1;
  }
}

function isMissingColumnError(error: unknown): boolean {
  return z.object({ code: z.literal("P2022") }).safeParse(error).success;
}
