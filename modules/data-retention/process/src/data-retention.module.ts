import { defineProcessModule } from "@langwatch/process";

import { DataRetentionModule } from "./app/data-retention.app.ts";
import { dataRetentionRepositories } from "./repositories/data-retention-repositories.registry.ts";
import { dataRetentionTrpcTransport } from "./transport/data-retention.trpc.ts";

export const dataRetentionProcessModule = defineProcessModule("data-retention")
  .withRepositories(dataRetentionRepositories)
  .withApi(DataRetentionModule)
  .withTransports(dataRetentionTrpcTransport);
