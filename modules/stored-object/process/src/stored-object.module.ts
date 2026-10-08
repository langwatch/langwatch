import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { StoredObjectApi, StoredObjectServerConfig } from "@langwatch/stored-object-contract";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { StoredObjectModule } from "#app/stored-object.app";
import { storedObjectChannels } from "#channels/stored-object-channels.registry";
import { storedObjectRepositories } from "#repositories/stored-object-repositories.registry";
import { LegacyEvaluationInputsPurgeService } from "#services/legacy-evaluation-inputs-purge.service";
import { storedObjectFileRest } from "#transport/stored-object-file.rest";
import { storedObjectImageProxyRest } from "#transport/stored-object-image-proxy.rest";
import { storedObjectRest } from "#transport/stored-object.rest";
import { storedObjectTrpcTransport } from "#transport/stored-object.trpc";

export const storedObjectProcessModule: PublishedProcessModule<
  "stored-object",
  StoredObjectApi,
  StoredObjectServerConfig
> = defineProcessModule("stored-object")
  .withRepositories(storedObjectRepositories)
  .withChannels(storedObjectChannels)
  .withApi(StoredObjectModule)
  .withTransports(
    storedObjectRest,
    storedObjectFileRest,
    storedObjectImageProxyRest,
    storedObjectTrpcTransport,
  )
  // After old writers are gone: evaluation copies its inputs before the purge (ADR-172).
  .withMigrations(({ repositories }) => [
    defineMigrationStep({
      id: "stored-object:purge-legacy-evaluation-inputs",
      kind: "data",
      mode: "background",
      description:
        "Deletes the evaluation input files and their records left by earlier versions; other files are untouched.",
      needsOldWritersGone: true,
      run: ({ dryRun, signal }) =>
        LegacyEvaluationInputsPurgeService.create({
          records: repositories.records,
          bytes: repositories.bytes,
        }).purge({ apply: !dryRun, signal }),
    }),
  ]);
