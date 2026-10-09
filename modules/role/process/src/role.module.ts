import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { RoleApi } from "@langwatch/role-contract";

import { RoleModule } from "./app/role.app.ts";
import { roleRepositories } from "./repositories/role-repositories.registry.ts";
import { roleRest, roleRestFacts } from "./transport/role.rest.ts";
import { roleTrpcTransport } from "./transport/role.trpc.ts";

export const roleProcessModule: PublishedProcessModule<"role", RoleApi> = defineProcessModule(
  "role",
)
  .withRepositories(roleRepositories)
  .withApi(RoleModule)
  .withTransports(roleRest, roleTrpcTransport)
  .withTransportFacts(() => [
    bindRestMiddleware(roleRestFacts, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return { organizationId: credential.organizationId, apiKeyId: credential.apiKeyId };
    }),
  ]);
