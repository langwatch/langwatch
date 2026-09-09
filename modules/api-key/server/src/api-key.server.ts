import { defineModule } from "@langwatch/runtime-composition";
import { ApiKeyApp } from "./app/api-key.app.ts";
import { apiKeyRepositories } from "./repositories/api-key-repositories.registry.ts";
import { apiKeyRest } from "./transport/api-key.rest.ts";
import { apiKeyTrpcTransport } from "./transport/api-key.trpc.ts";

export const apiKeyServer = defineModule("api-key")
  .withRepositories(apiKeyRepositories)
  .withApp(ApiKeyApp)
  .withTransports(apiKeyRest, apiKeyTrpcTransport)
  .build();
