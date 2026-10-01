import { defineServerModule } from "@langwatch/kernel";

import { SecretApp } from "./app/secret.app.ts";
import { secretRepositories } from "./repositories/secret-repositories.registry.ts";
import { secretRest } from "./transport/secret.rest.ts";
import { secretTrpcTransport } from "./transport/secret.trpc.ts";

export const secretServer = defineServerModule("secret")
  .withRepositories(secretRepositories)
  .withApp(SecretApp)
  .withTransports(secretRest, secretTrpcTransport);
