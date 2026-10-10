import { projectRequestContextOf } from "@langwatch/api/rest";
import type { DatasetApi, DatasetServerConfig } from "@langwatch/dataset-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { DatasetModule } from "#app/dataset.app";
import { datasetNormalizationEventing } from "#eventing/dataset-normalization.pipeline";
import { datasetRepositories } from "#repositories/dataset-repositories.registry";
import { DatasetMigrationService } from "#services/dataset-migration.service";
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
  .provideMiddlewareContext({ projectRequestContext: projectRequestContextOf })
  .withEventing(datasetNormalizationEventing)
  // Background, after old writers are gone: an older image may still write postgres-layout content.
  .withMigrations(({ repositories, dependencies }) => [
    defineMigrationStep({
      id: "dataset:move-content-to-object-storage",
      kind: "data",
      mode: "background",
      description: "Moves each dataset's content out of Postgres and into object-storage chunks.",
      needsOldWritersGone: true,
      run: (args) =>
        DatasetMigrationService.create({
          repository: repositories.migration,
          storage: repositories.migrationChunks,
          projects: dependencies.projects,
        }).runStep(args),
    }),
  ]);
