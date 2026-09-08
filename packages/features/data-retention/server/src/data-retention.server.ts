import { defineFeature } from "@langwatch/runtime-composition";
import { DataRetentionApp } from "./app/data-retention.app.ts";
import { dataRetentionRepositories } from "./repositories/data-retention-repositories.registry.ts";
import { dataRetentionTrpcTransport } from "./transport/data-retention.trpc.ts";

export const dataRetentionServer = defineFeature("data-retention")
  .withRepositories(dataRetentionRepositories)
  .withApp(DataRetentionApp)
  .withTransports(dataRetentionTrpcTransport)
  .build();
