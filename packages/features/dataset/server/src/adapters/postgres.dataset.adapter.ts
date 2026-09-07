import { DatasetNormalizeAdapter } from "./dataset-normalize.adapter.ts";
import type {
  DatasetNormalizePayload,
  DatasetService as DatasetServiceContract,
} from "@langwatch/dataset-contract";
import { DatasetService } from "../services/dataset.service.ts";
import { DatasetRecordRepository } from "../repositories/dataset-record.repository.ts";
import { DatasetRepository } from "../repositories/dataset.repository.ts";
import {
  PrismaDatasetRecordRepository,
  type DatasetRecordDatabase,
} from "../repositories/prisma/prisma.dataset-record.repository.ts";
import {
  PrismaDatasetRepository,
  type DatasetDatabase,
} from "../repositories/prisma/prisma.dataset.repository.ts";
import type {
  DatasetNormalizeQueuePort,
  DatasetUploadPort,
  DatasetContentPort,
} from "../ports/dataset.port.ts";
import type { DatasetStorageResolverPort } from "../ports/dataset-storage.port.ts";
import { DatasetUploadAdapter } from "./dataset-upload.adapter.ts";
import {
  PrismaDatasetContentRepository,
  type DatasetContentDatabase,
} from "../repositories/prisma/prisma.dataset-content.repository.ts";
import {
  DatasetRecordContentRepository,
  type DatasetRecordContentDatabase,
} from "../repositories/prisma/dataset-record-content.repository.ts";
import { DatasetContentAdapter } from "./dataset-content.adapter.ts";
import { DatasetNormalizationService } from "../services/dataset-normalization.service.ts";

export type PostgresDatasetAdapterOptions = {
  database: DatasetDatabase &
    DatasetRecordDatabase &
    DatasetContentDatabase &
    DatasetRecordContentDatabase;
  storage?: DatasetUploadPort;
  queue?: DatasetNormalizeQueuePort;
  content?: DatasetContentPort;
  storageResolver?: DatasetStorageResolverPort;
  generateId?: () => string;
};

export class PostgresDatasetAdapter {
  private readonly service: DatasetServiceContract;
  private readonly normalization: DatasetNormalizationService | null;

  private constructor(options: PostgresDatasetAdapterOptions) {
    const repository: DatasetRepository = PrismaDatasetRepository.create(options.database);
    const records: DatasetRecordRepository = PrismaDatasetRecordRepository.create(options.database);
    const contentRepository = PrismaDatasetContentRepository.create(options.database);
    const recordContentRepository = DatasetRecordContentRepository.create(options.database);
    const storageResolver = options.storageResolver;
    this.normalization = storageResolver
      ? DatasetNormalizationService.create({
          datasets: contentRepository,
          normalize: DatasetNormalizeAdapter.create({
            repository: contentRepository,
            getStorage: (projectId) => storageResolver.forProject(projectId),
          }),
        })
      : null;
    this.service = DatasetService.create({
      repository,
      records,
      uploads:
        options.storage ??
        (options.storageResolver
          ? DatasetUploadAdapter.create({
              datasets: contentRepository,
              records: recordContentRepository,
              storageResolver: options.storageResolver,
            })
          : undefined),
      queue: options.queue ?? this.normalization ?? undefined,
      content:
        options.content ??
        (options.storageResolver
          ? DatasetContentAdapter.create({
              datasets: contentRepository,
              storageResolver: options.storageResolver,
            })
          : undefined),
      storageResolver: options.storageResolver,
      generateId: options.generateId,
    });
  }

  static create(options: PostgresDatasetAdapterOptions): PostgresDatasetAdapter {
    return new PostgresDatasetAdapter(options);
  }

  build(): DatasetServiceContract {
    return this.service;
  }

  connectNormalization(sender: (payload: DatasetNormalizePayload) => Promise<void>): void {
    this.requireNormalization().connect(sender);
  }

  processNormalization(payload: DatasetNormalizePayload): Promise<void> {
    return this.requireNormalization().process(payload);
  }

  private requireNormalization(): DatasetNormalizationService {
    if (!this.normalization) {
      throw new Error("Dataset normalization is not configured");
    }
    return this.normalization;
  }
}
