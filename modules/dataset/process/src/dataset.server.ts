import type { DatasetNormalizationWorker } from "@langwatch/dataset-contract";
import { defineServerModule } from "@langwatch/kernel";

import { DatasetApp } from "#app/dataset.app";
import type { DatasetNormalize, DatasetNormalizeQueue } from "#app/dataset.app";
import type { DatasetContentRepository } from "#repositories/dataset-content.repository";
import { datasetRepositories } from "#repositories/dataset-repositories.registry";
import { DatasetNormalizationService } from "#services/dataset-normalization.service";
import { DatasetNormalizeAdapter } from "#services/dataset-normalize.service";
import type { DatasetNormalizeDeps } from "#services/dataset-normalize.service";
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

/** Normalization seams for a composing process. */
export function createDatasetNormalize(deps: DatasetNormalizeDeps): DatasetNormalize {
  return DatasetNormalizeAdapter.create(deps);
}

export function createDatasetNormalization(options: {
  datasets: DatasetContentRepository;
  normalize: DatasetNormalize;
}): DatasetNormalizeQueue & DatasetNormalizationWorker {
  return DatasetNormalizationService.create(options);
}
