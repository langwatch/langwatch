/**
 * tRPC router for the Billing events ledger screen: a read-only,
 * newest-first, cursor-paged view over `gateway_spend_events`, the
 * per-request billing record the gateway_spend pipeline writes
 * unconditionally. Project-scoped like the neighboring gateway usage
 * reads; org-wide rollups are a later fast-follow.
 */
import { z } from "zod";

import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { GatewaySpendEventsRepository } from "~/server/gateway/spendEvents.clickhouse.repository";

import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

async function resolveClient(projectId: string) {
  const client = await getClickHouseClientForProject(projectId);
  if (!client) {
    throw new Error(
      `ClickHouse enabled but no client for project ${projectId}`,
    );
  }
  return client;
}

export const gatewaySpendEventsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        fromMs: z.number().int(),
        toMs: z.number().int(),
        virtualKeyId: z.string().optional(),
        endUserId: z.string().optional(),
        model: z.string().optional(),
        status: z
          .enum(["success", "error", "admitted", "confirmed", "failed", "settled"])
          .optional(),
        cursor: z
          .object({
            occurredAtMs: z.number().int(),
            gatewayRequestId: z.string(),
          })
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .use(checkProjectPermission("gatewayUsage:view"))
    .query(async ({ ctx, input }) => {
      if (!isClickHouseEnabled()) {
        return {
          rows: [],
          nextCursor: null,
          virtualKeyNames: {} as Record<string, string>,
          clickHouseDisabled: true,
        };
      }
      const repository = new GatewaySpendEventsRepository(resolveClient);
      const { rows, nextCursor } = await repository.readSpendEventsPage({
        tenantId: input.projectId,
        fromMs: input.fromMs,
        toMs: input.toMs,
        filters: {
          virtualKeyId: input.virtualKeyId,
          endUserId: input.endUserId,
          model: input.model,
          status: input.status,
        },
        cursor: input.cursor,
        limit: input.limit ?? 50,
      });

      const vkIds = [...new Set(rows.map((r) => r.virtualKeyId))].filter(
        (id) => id.length > 0,
      );
      const vks = vkIds.length
        ? await ctx.prisma.virtualKey.findMany({
            where: { id: { in: vkIds } },
            select: { id: true, name: true },
          })
        : [];
      const virtualKeyNames = Object.fromEntries(
        vks.map((vk) => [vk.id, vk.name]),
      );

      return { rows, nextCursor, virtualKeyNames, clickHouseDisabled: false };
    }),
});
