import {
  DatasetAzureConfigResolver,
  DatasetStorageResolver,
  LocalDatasetStorageAdapter,
  S3DatasetStorageAdapter,
  AzureDatasetStorageAdapter,
  type DatasetStorage,
} from "@langwatch/dataset-server";
import { AzureBlobDriver } from "~/server/stored-objects/azure-blob-driver";
import { resolveAzureCredentials } from "~/server/stored-objects/azure-credentials";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { AppDatasetS3ClientManager } from "./dataset-s3-client-manager";
import type { DatasetS3ClientConfigBuilder } from "./dataset-s3-client-manager";
import type { AppAwsClientConfiguration } from "~/runtime/app/aws-client.composition";
import type { AzureIdentityConfig } from "~/runtime/azure-identity.config";

class AppAzureConfigResolver extends DatasetAzureConfigResolver {
  constructor(private readonly identity: AzureIdentityConfig | undefined) {
    super();
  }

  async resolve(projectId: string) {
    const destination = await resolveProjectStorageDestination(projectId);
    if (destination.kind !== "azure") {
      throw new Error(`Dataset storage destination is ${destination.kind}, not azure`);
    }
    return {
      driver: new AzureBlobDriver(resolveAzureCredentials({ identity: this.identity })),
      accountName: destination.accountName,
      container: destination.container,
    };
  }
}

export class AppDatasetStorageResolver extends DatasetStorageResolver {
  private readonly s3Clients: AppDatasetS3ClientManager;
  private readonly s3: S3DatasetStorageAdapter;
  private readonly azure: AzureDatasetStorageAdapter;

  constructor(
    options: {
      aws?: Pick<AppAwsClientConfiguration, "build">;
      buildS3ClientConfig?: DatasetS3ClientConfigBuilder;
      azureIdentity?: AzureIdentityConfig;
    } = {},
  ) {
    super();
    this.s3Clients = AppDatasetS3ClientManager.create({
      aws: options.aws,
      buildClientConfig: options.buildS3ClientConfig,
    });
    this.s3 = S3DatasetStorageAdapter.create(this.s3Clients);
    this.azure = AzureDatasetStorageAdapter.create(
      new AppAzureConfigResolver(options.azureIdentity),
    );
  }

  async forProject(projectId: string): Promise<DatasetStorage> {
    const destination = await resolveProjectStorageDestination(projectId);
    if (destination.kind === "s3") return this.s3;
    if (destination.kind === "azure") return this.azure;
    return LocalDatasetStorageAdapter.create(destination.root);
  }

  close(): Promise<void> {
    return this.s3Clients.close();
  }
}
