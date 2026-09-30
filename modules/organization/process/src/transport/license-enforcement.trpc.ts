/**
 * The server half of `licenseEnforcement.*`. Reading a limit takes
 * `organization:view`, which every member holds: a member who cannot invite
 * anybody should still be told the seats are full, not shown a control that fails.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { licenseEnforcementTrpc, OrganizationApi } from "@langwatch/organization-contract";

import { callerOf, organizationSessionPersonFact } from "./organization.trpc.ts";

export const licenseEnforcementTrpcTransport: TrpcRouterDeclaration<
  OrganizationApi,
  typeof licenseEnforcementTrpc
> = defineTrpcRouter(OrganizationApi, licenseEnforcementTrpc)
  .procedure("checkLimit")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:view")
  .handle(({ app, input, actor }, person) => app.checkLimit(input, callerOf(actor, person)))

  .procedure("checkAllLimits")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:view")
  .handle(({ app, input, actor }, person) => app.checkAllLimits(input, callerOf(actor, person)))

  // Fire-and-forget from the client's side; the application re-checks first.
  .procedure("reportLimitBlocked")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:view")
  .handle(({ app, input, actor }, person) => app.reportLimitBlocked(input, callerOf(actor, person)))
  .build();
