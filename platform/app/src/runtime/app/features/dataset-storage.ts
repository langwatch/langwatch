import {
  DatasetAzureConfigResolver,
  DatasetS3ClientResolver,
  DatasetStorageResolver,
  LocalDatasetStorageAdapter,
  S3DatasetStorageAdapter,
  AzureDatasetStorageAdapter,
  type DatasetStorage,
} from "@langwatch/dataset-server";
import { AzureBlobDriver } from "~/server/stored-objects/azure-blob-driver";
import { resolveAzureCredentials } from "~/server/stored-objects/azure-credentials";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { createS3Client } from "~/server/storage";

class AppS3ClientResolver extends DatasetS3ClientResolver {
  resolve(projectId: string) {
    return createS3Client(projectId);
  }
}

class AppAzureConfigResolver extends DatasetAzureConfigResolver {
  async resolve(projectId: string) {
    const destination = await resolveProjectStorageDestination(projectId);
    if (destination.kind !== "azure") {
      throw new Error(`Dataset storage destination is ${destination.kind}, not azure`);
    }
    return {
      driver: new AzureBlobDriver(resolveAzureCredentials()),
      accountName: destination.accountName,
      container: destination.container,
    };
  }
}

export class AppDatasetStorageResolver extends DatasetStorageResolver {
  private readonly s3 = S3DatasetStorageAdapter.create(new AppS3ClientResolver());
  private readonly azure = AzureDatasetStorageAdapter.create(
    new AppAzureConfigResolver(),
  );

  async forProject(projectId: string): Promise<DatasetStorage> {
    const destination = await resolveProjectStorageDestination(projectId);
    if (destination.kind === "s3") return this.s3;
    if (destination.kind === "azure") return this.azure;
    return LocalDatasetStorageAdapter.create(destination.root);
  }
}
