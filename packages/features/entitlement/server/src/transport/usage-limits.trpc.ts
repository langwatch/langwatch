/**
 * The server half of `limits.*`. The read takes `organization:view` — every
 * member sees the allowance they work inside. The notification takes
 * `organization:manage`: it mails the administrators with caller-supplied
 * counts, so a non-admin must not be able to trigger it.
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
