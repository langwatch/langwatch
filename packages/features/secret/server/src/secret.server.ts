import { defineFeature } from "@langwatch/runtime-composition";
import { SecretApp } from "./app/secret.app.ts";
import { secretRepositories } from "./repositories/secret-repositories.registry.ts";
import { secretRest, secretsAliasRest } from "./transport/secret.rest.ts";
import { secretTrpcTransport } from "./transport/secret.trpc.ts";

export const secretServer = defineFeature("secret")
  .withRepositories(secretRepositories)
  .withApp(SecretApp)
  .withTransports(secretRest, secretsAliasRest, secretTrpcTransport)
  .build();
