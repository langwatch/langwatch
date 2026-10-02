// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `scimReconciliation.*`: the settings page's read of what
 * its directory has been asking for (ADR-126).
 *
 * `sso:view` — seeing what a directory did is a different job from managing
 * it, and a reviewer checking whether a leaver was removed has no business
 * being handed a control that mints credentials.
 *
 * The request log takes no Enterprise plan gate: its headline case is a plan
 * that lapsed, and gating it would withhold "why did my push stop" on the
 * grounds that the push stopped. The other three declare the plan, asked after access.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { ScimApi, scimReconciliationTrpc } from "@langwatch/enterprise-scim-contract";

export const scimReconciliationTrpcTransport: TrpcRouterDeclaration<
  ScimApi,
  typeof scimReconciliationTrpc
> = defineTrpcRouter(ScimApi, scimReconciliationTrpc)
  .procedure("getAll")
  .withEntitlement("enterprise", { feature: "SCIM" })
  .withPermission("sso:view")
  .handle(({ app, input }) => app.getDirectoryReconciliation(input))

  .procedure("getActivity")
  .withEntitlement("enterprise", { feature: "SCIM" })
  .withPermission("sso:view")
  .handle(({ app, input }) => app.findDirectoryActivity(input))

  .procedure("getRequests")
  .withPermission("sso:view")
  .handle(({ app, input }) => app.findDirectoryRequests(input))

  .procedure("getById")
  .withEntitlement("enterprise", { feature: "SCIM" })
  .withPermission("sso:view")
  .handle(async ({ app, input }) => (await app.findConnectionReconciliation(input))[0] ?? null)
  .build();
