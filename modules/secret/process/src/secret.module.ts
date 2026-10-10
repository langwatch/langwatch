import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { SecretApi } from "@langwatch/secret-contract";

import { SecretModule } from "./app/secret.app.ts";
import { secretRepositories } from "./repositories/secret-repositories.registry.ts";
import { secretRest } from "./transport/secret.rest.ts";
import { secretTrpcTransport } from "./transport/secret.trpc.ts";

export const secretProcessModule: PublishedProcessModule<"secret", SecretApi> = defineProcessModule(
  "secret",
)
  .withRepositories(secretRepositories)
  .withApi(SecretModule)
  .withTransports(secretRest, secretTrpcTransport);
