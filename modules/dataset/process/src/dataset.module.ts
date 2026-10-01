import { defineProcessModule } from "@langwatch/process";

import { DatasetModule } from "#app/dataset.app";
import { datasetNormalizationEventing } from "#eventing/dataset-normalization.pipeline";
import { datasetRepositories } from "#repositories/dataset-repositories.registry";
import { DatasetMigrationService } from "#services/dataset-migration.service";
import { DatasetContentBackfillTask } from "#tasks/dataset-content-backfill.task";
import { batchRecordTrpcTransport } from "#transport/batch-record.trpc";
import { datasetRecordTrpcTransport } from "#transport/dataset-record.trpc";
import { createDatasetRest } from "#transport/dataset.rest";
import { datasetTrpcTransport } from "#transport/dataset.trpc";

export const datasetProcessModule = defineProcessModule("dataset")
  .withRepositories(datasetRepositories)
  .withApi(DatasetModule)
  .withTransports(
    createDatasetRest(),
    datasetTrpcTransport,
    datasetRecordTrpcTransport,
    batchRecordTrpcTransport,
  )
  .withEventing(datasetNormalizationEventing)
  .withTasks(({ repositories }) => [
    DatasetContentBackfillTask.create({
      migration: () =>
        DatasetMigrationService.create({
          repository: repositories.migration,
          storage: repositories.migrationChunks,
        }),
    }),
  ]);
