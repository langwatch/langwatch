import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { StoredObjectApi, StoredObjectServerConfig } from "@langwatch/stored-object-contract";

import { StoredObjectModule } from "#app/stored-object.app";
import { storedObjectChannels } from "#channels/stored-object-channels.registry";
import { storedObjectEventing } from "#eventing/stored-object-maintenance.pipeline";
import { ClickHouseImportStoredObjectMigration } from "#migrations/clickhouse-import.stored-object.migration";
import { storedObjectRepositories } from "#repositories/stored-object-repositories.registry";
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
  .withEventing(storedObjectEventing)
  .withMigrations(({ repositories }) => [
    ClickHouseImportStoredObjectMigration.create({
      legacy: repositories.legacySource,
      records: repositories.records,
    }).step(),
  ]);
