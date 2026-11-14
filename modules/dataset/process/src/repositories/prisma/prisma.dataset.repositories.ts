import type { DatasetServerConfig } from "@langwatch/dataset-contract";
import { prismaRepositories } from "@langwatch/prisma-client";
import type { ObjectStorage } from "@langwatch/process-stores/members";

import type { DatasetSingleFileRepository } from "../dataset-single-file.repository.ts";
import type { DatasetRepositories } from "../dataset.repositories.ts";
import { FilesystemDatasetSingleFileRepository } from "../filesystem/filesystem.dataset-single-file.repository.ts";
import { ObjectStorageDatasetChunkRepository } from "../object-storage/object-storage.dataset-chunk.repository.ts";
import { ObjectStorageDatasetSingleFileRepository } from "../object-storage/object-storage.dataset-single-file.repository.ts";
import { ObjectStorageDatasetVersionContentRepository } from "../object-storage/object-storage.dataset-version-content.repository.ts";
import { PrismaBatchEvaluationRepository } from "./prisma.batch-evaluation.repository.ts";
import { PrismaDatasetContentRepository } from "./prisma.dataset-content.repository.ts";
import { PrismaDatasetCountRepository } from "./prisma.dataset-count.repository.ts";
import { PrismaDatasetMigrationRepository } from "./prisma.dataset-migration.repository.ts";
import { PrismaDatasetRecordContentRepository } from "./prisma.dataset-record-content.repository.ts";
import { PrismaDatasetRecordRepository } from "./prisma.dataset-record.repository.ts";
import { PrismaDatasetVersionRepository } from "./prisma.dataset-version.repository.ts";
import { PrismaDatasetRepository } from "./prisma.dataset.repository.ts";

const PostgresDatasetTableRepositories = prismaRepositories({
  datasets: PrismaDatasetRepository,
  records: PrismaDatasetRecordRepository,
  content: PrismaDatasetContentRepository,
  recordContent: PrismaDatasetRecordContentRepository,
  batchEvaluations: PrismaBatchEvaluationRepository,
  count: PrismaDatasetCountRepository,
  versions: PrismaDatasetVersionRepository,
});

/** Dataset's live stores: its Postgres tables, plus the content move into object storage. */
export class PostgresDatasetRepositories {
  static readonly requires = ["prisma", "objectStorage"] as const;
  static readonly repositories = PostgresDatasetTableRepositories.repositories;

  static create({
    prisma,
    objectStorage,
    config,
  }: Parameters<typeof PostgresDatasetTableRepositories.create>[0] & {
    objectStorage: ObjectStorage;
    config: Pick<DatasetServerConfig, "singleFileStorage">;
  }): DatasetRepositories {
    const chunks = ObjectStorageDatasetChunkRepository.create({ objectStorage });
    return {
      ...PostgresDatasetTableRepositories.create({ prisma }),
      chunks,
      migration: PrismaDatasetMigrationRepository.create({ database: prisma }),
      migrationChunks: chunks,
      singleFiles: singleFilesOf({ objectStorage, storage: config.singleFileStorage }),
      versionContent: ObjectStorageDatasetVersionContentRepository.create({ objectStorage }),
    };
  }
}

/** Where single-file datasets were kept: local disk if told so, else object storage. */
function singleFilesOf({
  objectStorage,
  storage,
}: {
  objectStorage: ObjectStorage;
  storage: DatasetServerConfig["singleFileStorage"];
}): DatasetSingleFileRepository {
  return storage.onLocalDisk
    ? FilesystemDatasetSingleFileRepository.create({ localPath: storage.localPath })
    : ObjectStorageDatasetSingleFileRepository.create({ objectStorage });
}
