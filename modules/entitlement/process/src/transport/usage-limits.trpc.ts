/**
 * The server half of `limits.*`. The read takes `organization:view` — every
 * member sees their own allowance. The notification takes `organization:manage`,
 * since it mails administrators with caller-supplied counts.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { EntitlementApi, usageLimitsTrpc } from "@langwatch/entitlement-contract";

export const usageLimitsTrpcTransport = defineTrpcRouter(EntitlementApi, usageLimitsTrpc)
  .procedure("getUsage")
  .withPermission("organization:view")
  .handle(async ({ app, input, actor }) =>
    app.getUsage({
      organizationId: input.organizationId,
      operator: {
        id: actor.id,
        ...(actor.type === "user" && actor.impersonatorId
          ? { impersonatorId: actor.impersonatorId }
          : {}),
      },
    }),
  )

  .procedure("checkAndSendUsageLimitNotification")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) => app.sendUsageLimitWarning(input))
  .build();
