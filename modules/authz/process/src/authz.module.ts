import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { AuthzModule } from "./app/authz.app.ts";
import { authzEventing } from "./eventing/authz-grant.pipeline.ts";
import { authzRepositories } from "./repositories/authz-repositories.registry.ts";
import { authzGrantRest, grantRestFacts } from "./transport/authz-grant.rest.ts";
import { authzRoleBindingRest, roleBindingRestFacts } from "./transport/authz-role-binding.rest.ts";
import { authzTrpcTransport } from "./transport/authz.trpc.ts";

export type { AuthzInfrastructure } from "./app/authz.app.ts";

function organizationFactsOf(credential: {
  organizationId: string;
  apiKeyId: string;
  userId: string | null;
}) {
  return {
    organizationId: credential.organizationId,
    actor: credential.userId
      ? { type: "user" as const, id: credential.userId }
      : { type: "system" as const, id: null },
    caller: { type: "apiKey" as const, id: credential.apiKeyId },
  };
}

export const authzProcessModule = defineProcessModule("authz")
  .withRepositories(authzRepositories)
  .withApi(AuthzModule)
  .withTransports(authzGrantRest, authzRoleBindingRest, authzTrpcTransport)
  // The ledger row records the member behind the key, or the system where the
  // key acts as nobody: a service key is not a person and must not be written
  // into the trail as one.
  // Escalation is bounded by the key itself, never by its owner's wider standing.
  .withTransportFacts(() => [
    bindRestMiddleware(roleBindingRestFacts, (context) =>
      organizationFactsOf(organizationCredentialOfRequest(context.req.raw)),
    ),
    bindRestMiddleware(grantRestFacts, (context) =>
      organizationFactsOf(organizationCredentialOfRequest(context.req.raw)),
    ),
  ])
  .withEventing(authzEventing);
