/**
 * tRPC router for /gateway/usage. Read-only — historical spend from
 * the ClickHouse `gateway_budget_ledger_events` table (populated by the
 * trace-fold reactor), grouped by scope / model / day.
 */
import { z } from "zod";

import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { GatewayUsageService } from "~/server/gateway/usage.service";

import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

function chRepoOrUndefined() {
  if (!isClickHouseEnabled()) return undefined;
  return new GatewayBudgetClickHouseRepository(async (projectId) => {
    const client = await getClickHouseClientForProject(projectId);
    if (!client) {
      throw new Error(
        `ClickHouse enabled but no client for project ${projectId}`,
      );
    }
    return client;
  });
}

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
      const service = GatewayUsageService.create(ctx.prisma, chRepoOrUndefined());
      return service.summary(input.projectId, {
        fromDate: new Date(input.fromDate),
        toDate: new Date(input.toDate),
      });
    }),

  summaryForVirtualKey: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        virtualKeyId: z.string(),
        fromDate: z.string().datetime(),
        toDate: z.string().datetime(),
      }),
    )
    .use(checkProjectPermission("virtualKeys:view"))
    .query(async ({ ctx, input }) => {
      const service = GatewayUsageService.create(ctx.prisma, chRepoOrUndefined());
      return service.summaryForVirtualKey(
        input.projectId,
        input.virtualKeyId,
        {
          fromDate: new Date(input.fromDate),
          toDate: new Date(input.toDate),
        },
      );
    }),
});
