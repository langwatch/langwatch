// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for the Activity Monitor read-side queries that power
 * the /governance admin dashboard. Replaces Alexis's MOCK_* fixtures
 * with real data from gateway_activity_events (CH) + IngestionSource
 * (PG).
 *
 * RBAC: read-only — all procedures gate on `activityMonitor:view`
 * per the catalog in api/rbac.ts. Only org ADMIN (or a custom role
 * granting it) sees the dashboard. MEMBER + EXTERNAL roles get nothing
 * by default — the previous `organization:view` gate leaked all spend
 * + anomaly + ingestion-health views to every org member.
 *
 * Spec: specs/ai-gateway/governance/activity-monitor.feature
 */
import { z } from "zod";

import { ActivityMonitorService } from "@ee/governance/services/activity-monitor/activityMonitor.service";

import {
  ENTERPRISE_FEATURE_ERRORS,
  requireEnterprisePlan,
} from "~/server/api/enterprise";
import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const enterpriseGate = requireEnterprisePlan(
  ENTERPRISE_FEATURE_ERRORS.ACTIVITY_MONITOR,
);

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
    .use(checkOrganizationPermission("activityMonitor:view"))
    .use(enterpriseGate)
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
    .use(checkOrganizationPermission("activityMonitor:view"))
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ActivityMonitorService.create(ctx.prisma);
      return await service.spendByUser({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
        limit: input.limit,
      });
    }),

  /**
   * Per-team spend rollup. Aggregates ingestion-source events by the
   * source's `teamId` (with an "Org-wide" bucket for null-teamId
   * sources). Pairs with `spendByUser` for the admin bird's-eye home.
   */
  spendByTeam: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
        limit: z.number().int().min(1).max(500).default(50),
      }),
    )
    .use(checkOrganizationPermission("activityMonitor:view"))
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ActivityMonitorService.create(ctx.prisma);
      return await service.spendByTeam({
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
    .use(checkOrganizationPermission("activityMonitor:view"))
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ActivityMonitorService.create(ctx.prisma);
      return await service.ingestionSourcesHealth({
        organizationId: input.organizationId,
      });
    }),

  /**
   * Recent anomaly alerts produced by the anomaly-detection reactor.
   * Service-routed read of `prisma.anomalyAlert` keyed by org, sorted
   * by detectedAt DESC. Returns [] when no rules have fired or when
   * ClickHouse is disabled (the reactor short-circuits without CH).
   */
  recentAnomalies: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .use(checkOrganizationPermission("activityMonitor:view"))
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ActivityMonitorService.create(ctx.prisma);
      return await service.recentAnomalies({
        organizationId: input.organizationId,
        limit: input.limit,
      });
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
    .use(checkOrganizationPermission("activityMonitor:view"))
    .use(enterpriseGate)
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
    .use(checkOrganizationPermission("activityMonitor:view"))
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ActivityMonitorService.create(ctx.prisma);
      return await service.sourceHealthMetrics(input);
    }),
});
