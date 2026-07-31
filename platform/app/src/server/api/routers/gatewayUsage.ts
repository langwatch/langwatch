/**
 * tRPC router for /gateway/usage. Read-only — historical spend from
 * the ClickHouse `gateway_budget_ledger_events` table (populated by the
 * `gatewayBudgetDebits` map projection), grouped by scope / model / day.
 */
import { z } from "zod";

import {
  chRepoOrUndefined,
  spendRepoOrUndefined,
} from "~/server/gateway/clickhouseRepos";
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
