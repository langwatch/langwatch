import { defineFeature } from "@langwatch/runtime-composition";
import { DataRetentionApp } from "./app/data-retention.app.ts";
import { dataRetentionTrpcTransport } from "./transport/api-trpc/data-retention.api.ts";

export type {
  DataRetentionAppConfig,
  DataRetentionInfrastructure,
} from "./app/data-retention.app.ts";

export const dataRetentionServer = defineFeature("data-retention")
  .withApp(DataRetentionApp)
  .withTransports(dataRetentionTrpcTransport)
  .build();
