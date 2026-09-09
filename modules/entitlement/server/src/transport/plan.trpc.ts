/**
 * The server half of `plan.*`: `organization:view`, because every member sees
 * which plan they are on. WHICH source answers is a deployment decision.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { EntitlementApi, planTrpc } from "@langwatch/entitlement-contract";

export const planTrpcTransport = defineTrpcRouter(EntitlementApi, planTrpc)
  .procedure("getActivePlan")
  .withPermission("organization:view")
  .handle(async ({ app, input, actor }) =>
    app.getActivePlan({
      organizationId: input.organizationId,
      operator: {
        id: actor.id,
        ...(actor.type === "user" && actor.impersonatorId
          ? { impersonatorId: actor.impersonatorId }
          : {}),
      },
    }),
  )
  .build();
