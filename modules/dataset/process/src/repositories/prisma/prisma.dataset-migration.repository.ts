import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";
import { z } from "zod";

import type {
  DatasetMigrationFingerprint,
  DatasetMigrationMetadata,
  DatasetMigrationOutcome,
  DatasetMigrationRepository,
} from "../dataset-migration.repository.ts";
import {
  DATASET_MUTATION_TXN_MAX_WAIT_MS,
  DATASET_MUTATION_TXN_TIMEOUT_MS,
} from "./prisma.dataset-content.repository.ts";

const logger = createLogger("langwatch:dataset:migration");

/**
 * Process adapter for the one-off Postgres-to-object-storage migration. Takes
 * the process's own typed client, since Prisma's `aggregate` return type is
 * derived from its call arguments and no hand-written delegate can state it.
 */
export class PrismaDatasetMigrationRepository implements DatasetMigrationRepository {
  static create(options: { database: PrismaClient }): PrismaDatasetMigrationRepository {
    return new PrismaDatasetMigrationRepository(options);
  }

  private constructor(private readonly options: { database: PrismaClient }) {}

  async findProjectIds(): Promise<string[]> {
    const projects = await this.options.database.project.findMany({ select: { id: true } });
    return projects.map((project) => project.id);
  }

  async findPostgresDatasetIds(input: {
    projectId: string;
    afterId?: string | undefined;
    limit: number;
  }): Promise<string[]> {
    const page = await this.options.database.dataset.findMany({
      where: {
        projectId: input.projectId,
        contentLayout: "postgres",
        useS3: false,
        ...(input.afterId ? { id: { gt: input.afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: input.limit,
    });
    return page.map((dataset) => dataset.id);
  }

  async isPostgresLayout(input: { datasetId: string; projectId: string }): Promise<boolean> {
    const current = await this.options.database.dataset.findFirst({
      where: { id: input.datasetId, projectId: input.projectId },
      select: { contentLayout: true, useS3: true },
    });
    return current?.contentLayout === "postgres" && !current.useS3;
  }

  getFingerprint(input: {
    datasetId: string;
    projectId: string;
  }): Promise<DatasetMigrationFingerprint> {
    return fingerprintOf(this.options.database.datasetRecord, input);
  }

  async findRecordPage(input: {
    datasetId: string;
    projectId: string;
    afterId?: string | undefined;
    limit: number;
  }): Promise<{ id: string; entry: unknown }[]> {
    return this.options.database.datasetRecord.findMany({
      where: { datasetId: input.datasetId, projectId: input.projectId },
      select: { id: true, entry: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit,
      ...(input.afterId ? { cursor: { id: input.afterId }, skip: 1 } : {}),
    });
  }

  async commit(input: {
    datasetId: string;
    projectId: string;
    baseline: DatasetMigrationFingerprint;
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

        const recheck = await fingerprintOf(database.datasetRecord, {
          datasetId: input.datasetId,
          projectId: input.projectId,
        });
        const recordSetChanged =
          recheck.count !== input.baseline.count ||
          recheck.maxUpdatedAt?.epochMilliseconds !==
            input.baseline.maxUpdatedAt?.epochMilliseconds;
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

  isSchemaPending(error: unknown): boolean {
    return z.object({ code: z.literal("P2022") }).validate(error);
  }
}

async function fingerprintOf(
  records: PrismaClient["datasetRecord"],
  input: { datasetId: string; projectId: string },
): Promise<DatasetMigrationFingerprint> {
  const result = await records.aggregate({
    where: input,
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  const maxUpdatedAt = result._max.updatedAt;
  return { count: result._count._all, maxUpdatedAt: maxUpdatedAt ? fromDate(maxUpdatedAt) : null };
}
