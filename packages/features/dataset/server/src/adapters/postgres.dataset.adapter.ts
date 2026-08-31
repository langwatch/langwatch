import type {
  DatasetNormalizePayload,
  DatasetService as DatasetServiceContract,
} from "@langwatch/dataset-contract";
import { DatasetService } from "../services/dataset.service";
import { DatasetRecordRepository } from "../repositories/dataset-record.repository";
import { DatasetRepository } from "../repositories/dataset.repository";
import {
  PrismaDatasetRecordRepository,
  type DatasetRecordDatabase,
} from "../repositories/prisma/prisma.dataset-record.repository";
import {
  PrismaDatasetRepository,
  type DatasetDatabase,
} from "../repositories/prisma/prisma.dataset.repository";
import type {
  DatasetNormalizeQueuePort,
  DatasetUploadPort,
  DatasetContentPort,
} from "../ports/dataset.port";
import type { DatasetStorageResolver } from "../ports/dataset-storage.port";
import { DatasetUploadAdapter } from "./dataset-upload.adapter";
import {
  DatasetContentRepository,
  type DatasetContentDatabase,
} from "../repositories/prisma/dataset-content.repository";
import {
  DatasetRecordContentRepository,
  type DatasetRecordContentDatabase,
} from "../repositories/prisma/dataset-record-content.repository";
import { DatasetContentAdapter } from "./dataset-content.adapter";
import { DatasetNormalizationService } from "../services/dataset-normalization.service";

export type PostgresDatasetAdapterOptions = {
  database: DatasetDatabase &
    DatasetRecordDatabase &
    DatasetContentDatabase &
    DatasetRecordContentDatabase;
  storage?: DatasetUploadPort;
  queue?: DatasetNormalizeQueuePort;
  content?: DatasetContentPort;
  storageResolver?: DatasetStorageResolver;
  generateId?: () => string;
};

export class PostgresDatasetAdapter {
  private readonly service: DatasetServiceContract;
  private readonly normalization: DatasetNormalizationService | null;

  private constructor(options: PostgresDatasetAdapterOptions) {
    const repository: DatasetRepository = PrismaDatasetRepository.create(options.database);
    const records: DatasetRecordRepository = PrismaDatasetRecordRepository.create(options.database);
    const contentRepository = DatasetContentRepository.create(options.database);
    const recordContentRepository = DatasetRecordContentRepository.create(options.database);
    this.normalization = options.storageResolver
      ? DatasetNormalizationService.create({
          datasets: contentRepository,
          storage: options.storageResolver,
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
              records: recordContentRepository,
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
