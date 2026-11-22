import { organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { RoleApi } from "@langwatch/role-contract";

import { RoleModule } from "./app/role.app.ts";
import { roleRepositories } from "./repositories/role-repositories.registry.ts";
import { roleRest } from "./transport/role.rest.ts";
import { roleTrpcTransport } from "./transport/role.trpc.ts";

export const roleProcessModule: PublishedProcessModule<"role", RoleApi> = defineProcessModule(
  "role",
)
  .withRepositories(roleRepositories)
  .withApi(RoleModule)
  .withTransports(roleRest, roleTrpcTransport)
  .provideMiddlewareContext({
    roleRestContext: (request) => {
      const credential = organizationCredentialOfRequest(request);

      return { organizationId: credential.organizationId, apiKeyId: credential.apiKeyId };
    },
  });
