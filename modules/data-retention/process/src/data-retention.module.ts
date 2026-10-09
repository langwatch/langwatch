import type {
  DataRetentionApi,
  DataRetentionServerConfig,
} from "@langwatch/data-retention-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { DataRetentionModule } from "./app/data-retention.app.ts";
import { dataRetentionSeatPolicyEventing } from "./eventing/data-retention-seat-policy.pipeline.ts";
import { dataRetentionRepositories } from "./repositories/data-retention-repositories.registry.ts";
import { dataRetentionTrpcTransport } from "./transport/data-retention.trpc.ts";

export const dataRetentionProcessModule: PublishedProcessModule<
  "data-retention",
  DataRetentionApi,
  DataRetentionServerConfig
> = defineProcessModule("data-retention")
  .withRepositories(dataRetentionRepositories)
  .withApi(DataRetentionModule)
  .withTransports(dataRetentionTrpcTransport)
  .withEventing(dataRetentionSeatPolicyEventing);
