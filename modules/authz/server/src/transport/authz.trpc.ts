// Frontend query for caller's permissions; declared here to avoid package cycle.
import { defineTrpcContract } from "@langwatch/api/contract";
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  AuthzApi,
  authzOwnStandingInputSchema,
  authzOwnStandingSchema,
} from "@langwatch/authz-contract";

export const authzTrpc = defineTrpcContract("authz")
  .query("effectivePermissions")
  .withInput(authzOwnStandingInputSchema)
  .withOutput(authzOwnStandingSchema)
  .build();

/**
 * Membership itself is the only requirement: the answer is the caller's own
 * standing, and a non-member resolves to the empty set, which is the engine's
 * no-default-access answering rather than a refusal here.
 */
export const authzTrpcTransport = defineTrpcRouter(AuthzApi, authzTrpc)
  .procedure("effectivePermissions")
  .serviceAuthorized({
    reason:
      "resolves the caller's OWN effective permissions at the project or organization scope named; a non-member resolves to the empty set (no default access)",
    permissions: [],
  })
  .handle(async ({ app, input, actor }) => app.effectivePermissionsFor(input, { id: actor.id }))
  .build();
