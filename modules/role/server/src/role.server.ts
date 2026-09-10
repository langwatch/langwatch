import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { RoleApp } from "./app/role.app.ts";
import { roleRepositories } from "./repositories/role-repositories.registry.ts";
import { roleBindingTrpcTransport } from "./transport/role-binding.trpc.ts";
import { roleRest, roleRestFacts } from "./transport/role.rest.ts";
import { roleTrpcTransport } from "./transport/role.trpc.ts";

export const roleServer = defineServerModule("role")
  .withRepositories(roleRepositories)
  .withApp(RoleApp)
  .withTransports(roleRest, roleTrpcTransport, roleBindingTrpcTransport)
  .withTransportFacts(() => [
    bindRestMiddleware(roleRestFacts, (context) => ({
      organizationId: organizationCredentialOfRequest(context.req.raw).organizationId,
    })),
  ])
  .build();
