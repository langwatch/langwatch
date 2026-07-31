/**
 * tRPC router for /gateway/usage. Read-only — historical spend from
 * the ClickHouse `gateway_budget_ledger_events` table (populated by the
 * `gatewayBudgetDebits` map projection), grouped by scope / model / day.
 */
import { z } from "zod";

import { isClickHouseEnabled } from "~/server/app-layer/clients/clickhouse/shared";
import { clickHouseForProject } from "~/server/app-layer/clients/clickhouse/tenant-resolver";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { GatewayUsageService } from "~/server/gateway/usage.service";
import { GatewayVirtualKeySpendRepository } from "~/server/gateway/virtualKeySpend.clickhouse.repository";

import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

async function resolveClient(projectId: string) {
  const client = await clickHouseForProject(projectId);
  if (!client) {
    throw new Error(
      `ClickHouse enabled but no client for project ${projectId}`,
    );
  }
  return client;
}

export function chRepoOrUndefined() {
  if (!isClickHouseEnabled()) return undefined;
  return new GatewayBudgetClickHouseRepository(resolveClient);
}

export function spendRepoOrUndefined() {
  if (!isClickHouseEnabled()) return undefined;
  return new GatewayVirtualKeySpendRepository(resolveClient);
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
      const service = GatewayUsageService.create({
        prisma: ctx.prisma,
        chRepo: chRepoOrUndefined(),
        spendRepo: spendRepoOrUndefined(),
      });
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
      const service = GatewayUsageService.create({
        prisma: ctx.prisma,
        chRepo: chRepoOrUndefined(),
        spendRepo: spendRepoOrUndefined(),
      });
      return service.summaryForVirtualKey(input.projectId, input.virtualKeyId, {
        fromDate: new Date(input.fromDate),
        toDate: new Date(input.toDate),
      });
    }),
});
