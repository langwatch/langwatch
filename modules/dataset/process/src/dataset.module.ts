import type { DatasetApi, DatasetServerConfig } from "@langwatch/dataset-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { DatasetModule } from "#app/dataset.app";
import { datasetNormalizationEventing } from "#eventing/dataset-normalization.pipeline";
import { datasetRepositories } from "#repositories/dataset-repositories.registry";
import { DatasetMigrationService } from "#services/dataset-migration.service";
import { DatasetContentBackfillTask } from "#tasks/dataset-content-backfill.task";
import { datasetRecordTrpcTransport } from "#transport/dataset-record.trpc";
import { createDatasetRest } from "#transport/dataset.rest";
import { datasetTrpcTransport } from "#transport/dataset.trpc";

export const datasetProcessModule: PublishedProcessModule<
  "dataset",
  DatasetApi,
  DatasetServerConfig
> = defineProcessModule("dataset")
  .withRepositories(datasetRepositories)
  .withApi(DatasetModule)
  .withTransports(createDatasetRest(), datasetTrpcTransport, datasetRecordTrpcTransport)
  .withEventing(datasetNormalizationEventing)
  .withTasks(({ repositories, dependencies }) => [
    DatasetContentBackfillTask.create({
      migration: () =>
        DatasetMigrationService.create({
          repository: repositories.migration,
          storage: repositories.migrationChunks,
          projects: dependencies.projects,
        }),
    }),
  ]);
