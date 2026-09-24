import { prismaRepositories } from "@langwatch/prisma-client";
import type { ProcessMembers } from "@langwatch/process-stores/members";

import type { DatasetRepositories } from "../dataset.repositories.ts";
import { ObjectStorageDatasetChunkRepository } from "../object-storage/object-storage.dataset-chunk.repository.ts";
import { PrismaBatchEvaluationRepository } from "./prisma.batch-evaluation.repository.ts";
import { PrismaDatasetContentRepository } from "./prisma.dataset-content.repository.ts";
import { PrismaDatasetMigrationRepository } from "./prisma.dataset-migration.repository.ts";
import { PrismaDatasetRecordContentRepository } from "./prisma.dataset-record-content.repository.ts";
import { PrismaDatasetRecordRepository } from "./prisma.dataset-record.repository.ts";
import { PrismaDatasetUsageRepository } from "./prisma.dataset-usage.repository.ts";
import { PrismaDatasetRepository } from "./prisma.dataset.repository.ts";

const PostgresDatasetTableRepositories = prismaRepositories({
  datasets: PrismaDatasetRepository,
  records: PrismaDatasetRecordRepository,
  content: PrismaDatasetContentRepository,
  recordContent: PrismaDatasetRecordContentRepository,
  batchEvaluations: PrismaBatchEvaluationRepository,
  usage: PrismaDatasetUsageRepository,
});

/** Dataset's live stores: its Postgres tables, plus the content move into object storage. */
export class PostgresDatasetRepositories {
  static readonly requires = ["prisma", "objectStorage"] as const;
  static readonly repositories = PostgresDatasetTableRepositories.repositories;

  static create({
    prisma,
    objectStorage,
  }: Pick<ProcessMembers, "prisma" | "objectStorage">): DatasetRepositories {
    return {
      ...PostgresDatasetTableRepositories.create({ prisma }),
      migration: PrismaDatasetMigrationRepository.create({
        database: prisma,
        storage: ObjectStorageDatasetChunkRepository.create({ objectStorage }),
      }),
    };
  }
}
