import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { RoleApp } from "./app/role.app.ts";
import { roleRepositories } from "./repositories/role-repositories.registry.ts";
import { roleRest, roleRestFacts } from "./transport/role.rest.ts";
import { roleTrpcTransport } from "./transport/role.trpc.ts";

export const roleServer = defineServerModule("role")
  .withRepositories(roleRepositories)
  .withApp(RoleApp)
  .withTransports(roleRest, roleTrpcTransport)
  .withTransportFacts(() => [
    bindRestMiddleware(roleRestFacts, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return { organizationId: credential.organizationId, apiKeyId: credential.apiKeyId };
    }),
  ]);
