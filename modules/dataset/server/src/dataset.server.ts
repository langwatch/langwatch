import { defineServerModule } from "@langwatch/runtime-composition";
import { DatasetApp } from "#app/dataset.app";
import { datasetRepositories } from "#repositories/dataset-repositories.registry";
import { batchRecordTrpcTransport } from "#transport/batch-record.trpc";
import { createDatasetRest } from "#transport/dataset.rest";
import { datasetRecordTrpcTransport } from "#transport/dataset-record.trpc";
import { datasetTrpcTransport } from "#transport/dataset.trpc";

export const datasetServer = defineServerModule("dataset")
  .withRepositories(datasetRepositories)
  .withApp(DatasetApp)
  .withTransports(
    createDatasetRest(),
    datasetTrpcTransport,
    datasetRecordTrpcTransport,
    batchRecordTrpcTransport,
  )
  .build();
