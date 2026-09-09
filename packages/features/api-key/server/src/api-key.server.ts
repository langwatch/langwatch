import { defineFeature } from "@langwatch/runtime-composition";
import { ApiKeyApp } from "./app/api-key.app.ts";
import { apiKeyTrpcTransport } from "./transport/api-key.trpc.ts";

export const apiKeyServer = defineFeature("api-key")
  .withApp(ApiKeyApp)
  .withTransports(apiKeyTrpcTransport)
  .build();
