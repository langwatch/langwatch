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
 * grounds that the push stopped. The overview asks the plan, in the app.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { ScimApi, scimReconciliationTrpc } from "@langwatch/enterprise-scim-contract";

export const scimReconciliationTrpcTransport = defineTrpcRouter(ScimApi, scimReconciliationTrpc)
  .procedure("getAll")
  .withPermission("sso:view")
  .handle(({ app, input }) => app.getDirectoryReconciliation(input))

  .procedure("getRequests")
  .withPermission("sso:view")
  .handle(({ app, input }) => app.findDirectoryRequests(input))

  .procedure("getById")
  .withPermission("sso:view")
  .handle(async ({ app, input }) => (await app.findConnectionReconciliation(input))[0] ?? null)
  .build();
