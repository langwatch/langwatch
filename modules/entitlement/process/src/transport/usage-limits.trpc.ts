/**
 * The server half of `limits.*`. Every member reads their own allowance (`organization:view`); the
 * month breakdown names every project and the notification mails administrators, so both take
 * `organization:manage`, the audience of the limit email.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { EntitlementApi, usageLimitsTrpc } from "@langwatch/entitlement-contract";

export const usageLimitsTrpcTransport: TrpcRouterDeclaration<
  EntitlementApi,
  typeof usageLimitsTrpc
> = defineTrpcRouter(EntitlementApi, usageLimitsTrpc)
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

  .procedure("getMonthBreakdown")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) =>
    app.getUsageMonthBreakdown({ organizationId: input.organizationId }),
  )

  .procedure("checkAndSendUsageLimitNotification")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) => app.sendUsageLimitWarning(input))
  .build();
