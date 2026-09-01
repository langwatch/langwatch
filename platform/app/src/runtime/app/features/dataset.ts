import type { DatasetNormalizePayload, DatasetService } from "@langwatch/dataset-contract";
import {
  PostgresDatasetAdapter,
  type DatasetExperimentLookup,
  type DatasetNormalizeQueuePort,
  type DatasetUploadPort,
  type DatasetContentPort,
} from "@langwatch/dataset-server";
import type { PrismaClient } from "~/generated/prisma/client";
import type { AppAwsClientConfiguration } from "~/runtime/app/aws-client.composition";
import type { AzureIdentityConfig } from "~/runtime/azure-identity.config";
import { AppDatasetStorageResolver } from "./dataset-storage";

export type AppDatasetRuntimeOptions = {
  database: PrismaClient;
  experiments?: DatasetExperimentLookup;
  storage?: DatasetUploadPort;
  queue?: DatasetNormalizeQueuePort;
  /** Object-backed dataset reads/mutations; selected by the composition root. */
  content?: DatasetContentPort;
  /**
   * Process-owned AWS transport graph for the dataset object's S3 clients.
   * Required rather than optional because the runtime always owns a storage
   * resolver, and a resolver with no AWS graph can build no S3 client at all:
   * while this was optional the composition root omitted it, which compiled
   * and then threw out of `initializeDefaultApp` on every boot.
   */
  aws: Pick<AppAwsClientConfiguration, "build">;
  /**
   * Platform-injected federated identity, parsed once by the composition root.
   * It reaches the Azure driver's credential resolution; the sibling
   * destination and read-driver resolvers still read the same three variables
   * off `process.env`, so this is ownership of one arm, not of the whole
   * Azure path.
   */
  azureIdentity?: AzureIdentityConfig;
  generateId?: () => string;
};

/**
 * Process-owned Dataset composition. The feature server owns the service and
 * its private repositories; this application adapter only supplies concrete
 * infrastructure collaborators.
 */
export class AppDatasetRuntime {
  private readonly adapter: PostgresDatasetAdapter;
  private readonly storageResolver: AppDatasetStorageResolver;

  private constructor(
    options: AppDatasetRuntimeOptions,
    storageResolver: AppDatasetStorageResolver,
  ) {
    this.adapter = PostgresDatasetAdapter.create({ ...options, storageResolver });
    this.storageResolver = storageResolver;
  }

  static create(options: AppDatasetRuntimeOptions): AppDatasetRuntime {
    return new AppDatasetRuntime(
      options,
      new AppDatasetStorageResolver({
        aws: options.aws,
        azureIdentity: options.azureIdentity,
      }),
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
    return this.storageResolver.close();
  }
}
