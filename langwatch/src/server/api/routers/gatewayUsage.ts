/**
 * tRPC router for /gateway/usage. Read-only — historical spend from
 * GatewayBudgetLedger, grouped by scope / model / day.
 */
import { z } from "zod";

import { GatewayUsageService } from "~/server/gateway/usage.service";

import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const gatewayUsageRouter = createTRPCRouter({
  summary: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        fromDate: z.string().datetime(),
        toDate: z.string().datetime(),
      }),
    )
    .use(checkProjectPermission("gatewayUsage:view"))
    .query(async ({ ctx, input }) => {
      const service = GatewayUsageService.create(ctx.prisma);
      return service.summary(input.projectId, {
        fromDate: new Date(input.fromDate),
        toDate: new Date(input.toDate),
      });
    }),
});
