/**
 * "What may I do here" — the frontend's single source of truth for the
 * CALLER's own effective permissions at one scope (ADR-092 §5/§11).
 *
 * The declaration is stated HERE rather than in `@langwatch/authz-contract`,
 * which is where every other feature states one. `defineTrpcContract` ships
 * from `@langwatch/api`, and `@langwatch/api` depends on this feature's
 * contract for the permission vocabulary every route and procedure declares,
 * so a contract-side declaration would close a package cycle. The payload
 * shapes still live in the contract (`authz.queries.ts`), which is what a
 * browser reads.
 *
 * Which scope "here" means — a project id wins over an organization id riding
 * along with it — is decided in the app, because it is a decision about the
 * domain rather than about this transport.
 */
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
