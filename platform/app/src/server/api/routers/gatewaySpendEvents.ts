/**
 * tRPC router for the Billing events ledger screen: a read-only,
 * newest-first, cursor-paged view over `gateway_spend`, the
 * per-request billing record the gateway_spend pipeline writes
 * unconditionally. Project-scoped like the neighboring gateway usage
 * reads; org-wide rollups are a later fast-follow.
 */
import { z } from "zod";

import { spendFiltersSchema } from "@langwatch/gateway-server";

import { createTRPCRouter, protectedProcedure } from "../trpc";

export const gatewaySpendEventsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        fromMs: z.number().int(),
        toMs: z.number().int(),
        // The same filter set the REST reads narrow on, in the structured
        // spelling rather than the query-string one, so the screen and a
        // reconciliation script cannot come to mean different things by the
        // same narrowing.
        filters: spendFiltersSchema.optional(),
        cursor: z
          .object({
            occurredAtMs: z.number().int(),
            gatewayRequestId: z.string(),
          })
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .permission("gatewayUsage:view")
    .query(async ({ ctx, input }) => {
      const service = ctx.app.gateway.spendEvents;
      if (!service) {
        return {
          rows: [],
          nextCursor: null,
          virtualKeyNames: {} as Record<string, string>,
          clickHouseDisabled: true,
        };
      }
      const { rows, nextCursor } = await service.getSpendEventsPage({
        tenantId: input.projectId,
        fromMs: input.fromMs,
        toMs: input.toMs,
        filters: input.filters ?? {},
        cursor: input.cursor,
        limit: input.limit ?? 50,
      });

      const vkIds = [...new Set(rows.map((r) => r.virtualKeyId))].filter((id) => id.length > 0);
      // VirtualKey is ORG-scoped post-collapse (no projectId column); the
      // ids come from this project's own tenant-filtered spend rows, and
      // the Project service resolves the owning-org fence without exposing
      // Project persistence to this transport.
      const organizationId = await ctx.app.projects.tryGetOrganizationId(input.projectId);
      const vks =
        vkIds.length && organizationId
          ? await ctx.prisma.virtualKey.findMany({
              where: {
                id: { in: vkIds },
                organizationId,
              },
              select: { id: true, name: true },
            })
          : [];
      const virtualKeyNames = Object.fromEntries(vks.map((vk) => [vk.id, vk.name]));

      return { rows, nextCursor, virtualKeyNames, clickHouseDisabled: false };
    }),
});
