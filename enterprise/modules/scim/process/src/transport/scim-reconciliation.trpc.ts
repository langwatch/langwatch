// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `scimReconciliation.*`: the settings page's read of what
 * its directory has been asking for (ADR-126).
 *
 * `sso:view` — seeing what a directory did is a different job from managing
 * it, and a reviewer checking whether a leaver was removed has no business
 * being handed a control that mints credentials.
 *
 * No Enterprise plan gate, unlike `scimToken.*`: the headline case for reading
 * this is a plan that lapsed, and gating it would withhold the answer to "why
 * did my push stop" on the grounds that the push stopped.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { ScimApi, scimReconciliationTrpc } from "@langwatch/enterprise-scim-contract";

export const scimReconciliationTrpcTransport = defineTrpcRouter(ScimApi, scimReconciliationTrpc)
  .procedure("getRequests")
  .withPermission("sso:view")
  .handle(({ app, input }) => app.findDirectoryRequests(input))
  .build();
