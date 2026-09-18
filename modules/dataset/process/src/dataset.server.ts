import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { DatasetNormalizationWorker } from "@langwatch/dataset-contract";
import { defineServerModule } from "@langwatch/kernel";

import { DatasetApp } from "#app/dataset.app";
import type {
  DatasetAzureConfigResolver,
  DatasetNormalize,
  DatasetNormalizeQueue,
  DatasetS3ClientResolver,
  DatasetStorage,
  DatasetStorageResolver,
} from "#app/dataset.app";
import type { DatasetContentRepository } from "#repositories/dataset-content.repository";
import { datasetRepositories } from "#repositories/dataset-repositories.registry";
import { AzureDatasetStorageAdapter } from "#services/azure.dataset-storage.service";
import { DatasetNormalizationService } from "#services/dataset-normalization.service";
import { DatasetNormalizeAdapter } from "#services/dataset-normalize.service";
import type { DatasetNormalizeDeps } from "#services/dataset-normalize.service";
import {
  DatasetObjectStorageResolverAdapter,
  DatasetObjectStorageS3ClientResolverAdapter,
} from "#services/dataset-object-storage-resolver.service";
import type {
  DatasetS3Target,
  DatasetStorageDestinationService,
} from "#services/dataset-object-storage-resolver.service";
import { LocalDatasetStorageAdapter } from "#services/local.dataset-storage.service";
import { S3DatasetStorageAdapter } from "#services/s3.dataset-storage.service";
import { batchRecordTrpcTransport } from "#transport/batch-record.trpc";
import { datasetRecordTrpcTransport } from "#transport/dataset-record.trpc";
import { createDatasetRest } from "#transport/dataset.rest";
import { datasetTrpcTransport } from "#transport/dataset.trpc";

export const datasetServer = defineServerModule("dataset")
  .withRepositories(datasetRepositories)
  .withApp(DatasetApp)
  .withTransports(
    createDatasetRest(),
    datasetTrpcTransport,
    datasetRecordTrpcTransport,
    batchRecordTrpcTransport,
  );

/**
 * Storage and normalization seams for a composing process: thin factories
 * over this feature's private storage adapters, so a composition root never
 * names an `app/`/`services/` class directly (private-runtime-export drive).
 */
export function createS3DatasetStorage(resolver: DatasetS3ClientResolver): DatasetStorage {
  return S3DatasetStorageAdapter.create(resolver);
}

export function createAzureDatasetStorage(resolver: DatasetAzureConfigResolver): DatasetStorage {
  return AzureDatasetStorageAdapter.create(resolver);
}

export function createLocalDatasetStorage(root: string): DatasetStorage {
  return LocalDatasetStorageAdapter.create(root);
}

export function createDatasetObjectStorageS3ClientResolver(options: {
  aws: AwsClientProcessRuntime;
  lookupProjectTarget: (projectId: string) => Promise<DatasetS3Target | null>;
  globalS3: DatasetS3Target | undefined;
}): DatasetS3ClientResolver {
  return DatasetObjectStorageS3ClientResolverAdapter.create(options);
}

export function createDatasetObjectStorageResolver(options: {
  destination: DatasetStorageDestinationService;
  s3ClientResolver: DatasetS3ClientResolver;
  azureConfig?: DatasetAzureConfigResolver;
}): DatasetStorageResolver {
  return DatasetObjectStorageResolverAdapter.create(options);
}

export function createDatasetNormalize(deps: DatasetNormalizeDeps): DatasetNormalize {
  return DatasetNormalizeAdapter.create(deps);
}

export function createDatasetNormalization(options: {
  datasets: DatasetContentRepository;
  normalize: DatasetNormalize;
}): DatasetNormalizeQueue & DatasetNormalizationWorker {
  return DatasetNormalizationService.create(options);
}
