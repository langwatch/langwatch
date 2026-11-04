import { projectRequestContextOf } from "@langwatch/api/rest";
import type { DatasetApi, DatasetServerConfig } from "@langwatch/dataset-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { DatasetModule } from "#app/dataset.app";
import { datasetNormalizationEventing } from "#eventing/dataset-normalization.pipeline";
import { datasetVersionsEventing } from "#eventing/dataset-versions.pipeline";
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
  .withEventing(datasetVersionsEventing)
  // Background, after old writers are gone: an older image may still write postgres-layout content.
  .withMigrations(({ app, repositories, dependencies }) => [
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
    // Background and paced by its own work: it snapshots in its run and sends no queue work.
    defineMigrationStep({
      id: "dataset:create-first-versions",
      kind: "data",
      mode: "background",
      description: "Saves version 1 of every dataset that has no version history yet.",
      after: ["dataset:move-content-to-object-storage"],
      run: app.firstVersionsRun(),
    }),
  ]);
