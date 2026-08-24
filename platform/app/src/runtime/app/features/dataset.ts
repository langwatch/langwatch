import type { DatasetService } from "@langwatch/dataset-contract";
import {
  PostgresDatasetAdapter,
  type DatasetExperimentPort,
  type DatasetNormalizeQueuePort,
  type DatasetUploadPort,
  type DatasetContentPort,
  type DatasetStorageResolver,
  type DatasetNormalizePayload,
} from "@langwatch/dataset-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { AppDatasetStorageResolver } from "./dataset-storage";

/**
 * Process-owned Dataset composition. The feature server owns the service and
 * its private repositories; this application adapter only supplies concrete
 * infrastructure collaborators.
 */
export class AppDatasetRuntime {
  private readonly adapter: PostgresDatasetAdapter;

  private constructor(options: {
      database: PrismaClient;
      experiments?: DatasetExperimentPort;
      storage?: DatasetUploadPort;
      queue?: DatasetNormalizeQueuePort;
      /** Object-backed dataset reads/mutations; selected by the composition root. */
      content?: DatasetContentPort;
      storageResolver?: DatasetStorageResolver;
      generateId?: () => string;
    }) {
    this.adapter = PostgresDatasetAdapter.create(options);
  }

  static create(options: {
    database: PrismaClient;
    experiments?: DatasetExperimentPort;
    storage?: DatasetUploadPort;
    queue?: DatasetNormalizeQueuePort;
    /** Object-backed dataset reads/mutations; selected by the composition root. */
    content?: DatasetContentPort;
    storageResolver?: DatasetStorageResolver;
    generateId?: () => string;
  }): AppDatasetRuntime {
    return new AppDatasetRuntime({
      ...options,
      storageResolver: options.storageResolver ?? new AppDatasetStorageResolver(),
    });
  }

  build(): DatasetService {
    return this.adapter.build();
  }

  connectNormalization(
    sender: (payload: DatasetNormalizePayload) => Promise<void>,
  ): void {
    this.adapter.connectNormalization(sender);
  }

  processNormalization(payload: DatasetNormalizePayload): Promise<void> {
    return this.adapter.processNormalization(payload);
  }
}
