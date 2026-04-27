/**
 * tRPC router for the Activity Monitor read-side queries that power
 * the /governance admin dashboard. Replaces Alexis's MOCK_* fixtures
 * with real data from gateway_activity_events (CH) + IngestionSource
 * (PG).
 *
 * Spec: specs/ai-gateway/governance/activity-monitor.feature
 */
import { z } from "zod";

import { ActivityMonitorService } from "~/server/governance/activity-monitor/activityMonitor.service";

import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const activityMonitorRouter = createTRPCRouter({
  /**
   * Summary cards: total spend in window, delta vs previous window,
   * active users, anomaly count + breakdown.
   */
  summary: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = ActivityMonitorService.create(ctx.prisma);
      return await service.summary({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
      });
    }),

  /**
   * Per-user spend breakdown (top-N). Sorted by spend desc.
   */
  spendByUser: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
        limit: z.number().int().min(1).max(500).default(50),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = ActivityMonitorService.create(ctx.prisma);
      return await service.spendByUser({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
        limit: input.limit,
      });
    }),

  /**
   * Per-source health metrics for the dashboard's source strip.
   */
  ingestionSourcesHealth: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = ActivityMonitorService.create(ctx.prisma);
      return await service.ingestionSourcesHealth({
        organizationId: input.organizationId,
      });
    }),

  /**
   * Open anomalies. Returns [] until Option C (anomaly rule eval +
   * dispatch backend) lands. Stub here so the dashboard can wire to
   * the final shape without a follow-up frontend change.
   */
  recentAnomalies: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async () => {
      return [] as Array<{
        id: string;
        severity: "critical" | "warning" | "info";
        rule: string;
        sourceLabel: string;
        detectedAtIso: string;
        currentState: "open" | "acknowledged" | "resolved";
      }>;
    }),

  /**
   * Recent events for a single IngestionSource — powers the per-source
   * detail page's "raw vs normalised" preview. Cursor-paginated by
   * eventTimestamp DESC via the optional `beforeIso` parameter.
   */
  eventsForSource: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        sourceId: z.string(),
        limit: z.number().int().min(1).max(200).default(50),
        beforeIso: z.string().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = ActivityMonitorService.create(ctx.prisma);
      return await service.eventsForSource(input);
    }),

  /**
   * Volume metrics for one source over rolling 24h/7d/30d windows +
   * lastSuccessIso. Powers the per-source detail page's health header.
   */
  sourceHealthMetrics: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        sourceId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = ActivityMonitorService.create(ctx.prisma);
      return await service.sourceHealthMetrics(input);
    }),
});
