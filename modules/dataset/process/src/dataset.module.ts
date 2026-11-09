import { projectRequestContextOf } from "@langwatch/api/rest";
import type { DatasetApi, DatasetServerConfig } from "@langwatch/dataset-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep, type MigrationStepRun } from "@langwatch/upgrade/step";

import { DatasetModule } from "#app/dataset.app";
import { datasetNormalizationEventing } from "#eventing/dataset-normalization.pipeline";
import { datasetVersionsEventing } from "#eventing/dataset-versions.pipeline";
import { datasetRepositories } from "#repositories/dataset-repositories.registry";
import { DatasetEmptySlugService } from "#services/dataset-empty-slug.service";
import { DatasetMigrationService } from "#services/dataset-migration.service";
import { DatasetSingleFileConversionService } from "#services/dataset-single-file-conversion.service";
import { DatasetStorageAuditService } from "#services/dataset-storage-audit.service";
import { DatasetStorageAuditTask } from "#tasks/dataset-storage-audit.task";
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
  .withTasks(({ repositories, dependencies }) => [
    DatasetStorageAuditTask.create({
      audit: DatasetStorageAuditService.create({
        repository: repositories.storageAudit,
        projects: dependencies.projects,
      }),
    }),
  ])
  .withMigrations(({ app, repositories, dependencies }) => {
    const fillEmptySlugs = defineMigrationStep({
      id: "dataset:fill-empty-slugs",
      kind: "data",
      mode: "background",
      description: "Gives each dataset stored without a slug one made from its name.",
      run: (args) =>
        DatasetEmptySlugService.create({
          datasets: repositories.datasets,
          projects: dependencies.projects,
        }).runStep(args),
    });
    const moveContent = (args: Parameters<MigrationStepRun>[0]) =>
      DatasetMigrationService.create({
        repository: repositories.migration,
        storage: repositories.migrationChunks,
        projects: dependencies.projects,
      }).runStep(args);
    // Background, after old writers are gone: an older image may still write
    // postgres-layout content.
    const firstMove = defineMigrationStep({
      id: "dataset:move-content-to-object-storage",
      kind: "data",
      mode: "background",
      description: "Moves each dataset's content out of Postgres and into object-storage chunks.",
      needsOldWritersGone: true,
      run: moveContent,
    });
    // The same move under a new id: the first is recorded done on installs that ran it, and
    // 3.21.0 to 3.23.0 kept creating datasets in the records table after it ran.
    const remainingMove = defineMigrationStep({
      id: "dataset:move-remaining-content-to-object-storage",
      kind: "data",
      mode: "background",
      description:
        "Moves the datasets still in the Postgres records table, archived and empty ones too, into object-storage chunks.",
      needsOldWritersGone: true,
      after: [firstMove],
      run: moveContent,
    });
    return [
      firstMove,
      remainingMove,
      // Background, after old writers are gone: an older image still rewrites the single file.
      defineMigrationStep({
        id: "dataset:convert-single-file-datasets",
        kind: "data",
        mode: "background",
        description:
          "Converts each dataset an older release kept as one file into object-storage chunks, keeping the old file.",
        needsOldWritersGone: true,
        run: (args) =>
          DatasetSingleFileConversionService.create({
            conversion: repositories.singleFileConversion,
            datasets: repositories.content,
            files: repositories.singleFiles,
            chunks: repositories.chunks,
            projects: dependencies.projects,
          }).runStep(args),
      }),
      // Before any dataset read: a row stored with an empty slug cannot be read at all.
      fillEmptySlugs,
      // Background and paced by its own work: it snapshots in its run and sends no queue work.
      defineMigrationStep({
        id: "dataset:create-first-versions",
        kind: "data",
        mode: "background",
        description: "Saves version 1 of every dataset that has no version history yet.",
        after: [firstMove, remainingMove, fillEmptySlugs],
        run: app.firstVersionsRun(),
      }),
    ];
  });
