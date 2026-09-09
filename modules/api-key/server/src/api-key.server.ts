import { defineModule } from "@langwatch/runtime-composition";
import { ApiKeyApp } from "./app/api-key.app.ts";
import { apiKeyRest } from "./transport/api-key.rest.ts";
import { apiKeyTrpcTransport } from "./transport/api-key.trpc.ts";

export const apiKeyServer = defineModule("api-key")
  .withApp(ApiKeyApp)
  .withTransports(apiKeyRest, apiKeyTrpcTransport)
  .build();
