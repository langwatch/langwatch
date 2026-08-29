import type { DatasetNormalizePayload, DatasetService } from "@langwatch/dataset-contract";
import {
  PostgresDatasetAdapter,
  type DatasetExperimentLookup,
  type DatasetNormalizeQueuePort,
  type DatasetUploadPort,
  type DatasetContentPort,
  type DatasetStorageResolver,
} from "@langwatch/dataset-server";
import type { PrismaClient } from "~/generated/prisma/client";
import type { AppAwsClientConfiguration } from "~/runtime/app/aws-client.composition";
import type { AzureIdentityConfig } from "~/runtime/azure-identity.config";
import { AppDatasetStorageResolver } from "./dataset-storage";

/**
 * Process-owned Dataset composition. The feature server owns the service and
 * its private repositories; this application adapter only supplies concrete
 * infrastructure collaborators.
 */
export class AppDatasetRuntime {
  private readonly adapter: PostgresDatasetAdapter;
  private readonly ownedStorageResolver: AppDatasetStorageResolver | undefined;

  private constructor(
    options: {
      database: PrismaClient;
      experiments?: DatasetExperimentLookup;
      storage?: DatasetUploadPort;
      queue?: DatasetNormalizeQueuePort;
      /** Object-backed dataset reads/mutations; selected by the composition root. */
      content?: DatasetContentPort;
      storageResolver?: DatasetStorageResolver;
      aws?: Pick<AppAwsClientConfiguration, "build">;
      azureIdentity?: AzureIdentityConfig;
      generateId?: () => string;
    },
    ownedStorageResolver: AppDatasetStorageResolver | undefined,
  ) {
    this.adapter = PostgresDatasetAdapter.create(options);
    this.ownedStorageResolver = ownedStorageResolver;
  }

  static create(options: {
    database: PrismaClient;
    experiments?: DatasetExperimentLookup;
    storage?: DatasetUploadPort;
    queue?: DatasetNormalizeQueuePort;
    /** Object-backed dataset reads/mutations; selected by the composition root. */
    content?: DatasetContentPort;
    storageResolver?: DatasetStorageResolver;
    /** Process-owned AWS transport graph for the dataset object's S3 clients. */
    aws?: Pick<AppAwsClientConfiguration, "build">;
    /** Parsed platform identity used by Azure-backed dataset storage. */
    azureIdentity?: AzureIdentityConfig;
    generateId?: () => string;
  }): AppDatasetRuntime {
    const ownedStorageResolver = options.storageResolver
      ? undefined
      : new AppDatasetStorageResolver({
          aws: options.aws,
          azureIdentity: options.azureIdentity,
        });
    return new AppDatasetRuntime(
      {
        ...options,
        storageResolver: options.storageResolver ?? ownedStorageResolver,
      },
      ownedStorageResolver,
    );
  }

  build(): DatasetService {
    return this.adapter.build();
  }

  connectNormalization(sender: (payload: DatasetNormalizePayload) => Promise<void>): void {
    this.adapter.connectNormalization(sender);
  }

  processNormalization(payload: DatasetNormalizePayload): Promise<void> {
    return this.adapter.processNormalization(payload);
  }

  close(): Promise<void> {
    return this.ownedStorageResolver?.close() ?? Promise.resolve();
  }
}
