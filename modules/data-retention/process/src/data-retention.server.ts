import { defineServerModule } from "@langwatch/kernel";

import { DataRetentionApp } from "./app/data-retention.app.ts";
import { dataRetentionRepositories } from "./repositories/data-retention-repositories.registry.ts";
import { dataRetentionTrpcTransport } from "./transport/data-retention.trpc.ts";

export const dataRetentionServer = defineServerModule("data-retention")
  .withRepositories(dataRetentionRepositories)
  .withApp(DataRetentionApp)
  .withTransports(dataRetentionTrpcTransport);
