/**
 * The server half of `costs.*`. It takes `organization:view` — every member
 * sees the spend of the organization they belong to — and the rollup itself is
 * further narrowed to the projects that caller can actually reach.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { EntitlementApi, organizationSpendTrpc } from "@langwatch/entitlement-contract";

export const organizationSpendTrpcTransport = defineTrpcRouter(
  EntitlementApi,
  organizationSpendTrpc,
)
  .procedure("getAggregatedCostsForOrganization")
  .withPermission("organization:view")
  .handle(async ({ app, input, actor }) =>
    app.listOrganizationSpend({
      organizationId: input.organizationId,
      userId: actor.id,
      startDate: input.startDate,
      endDate: input.endDate,
    }),
  )
  .build();
