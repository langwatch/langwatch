import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { AuthzApp } from "./app/authz.app.ts";
import { authzRepositories } from "./repositories/authz-repositories.registry.ts";
import { authzRoleBindingRest, roleBindingRestFacts } from "./transport/authz-role-binding.rest.ts";
import { authzTrpcTransport } from "./transport/authz.trpc.ts";

export type { AuthzInfrastructure, AuthzSetup } from "./app/authz.app.ts";
export const authzServer = defineServerModule("authz")
  .withRepositories(authzRepositories)
  .withApp(AuthzApp)
  .withTransports(authzRoleBindingRest, authzTrpcTransport)
  // The ledger row records the member behind the key, or the system where the
  // key acts as nobody: a service key is not a person and must not be written
  // into the trail as one.
  .withTransportFacts(() => [
    bindRestMiddleware(roleBindingRestFacts, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return {
        organizationId: credential.organizationId,
        actor: credential.userId
          ? { type: "user" as const, id: credential.userId }
          : { type: "system" as const, id: null },
      };
    }),
  ])
  .build();
