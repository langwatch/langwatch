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

function extractSourceLabel(detail: unknown): string {
  const d = (detail as Record<string, unknown>) ?? {};
  if (typeof d.sourceLabel === "string") return d.sourceLabel;
  if (typeof d.source === "string") return d.source;
  return "";
}

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
   * Recent anomaly alerts produced by the anomaly-detection reactor
   * (C2). Reads AnomalyAlert rows from PG, sorted by detectedAt DESC.
   * Returns [] when no rules have fired or when ClickHouse is
   * disabled (the reactor short-circuits without CH access).
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
      const rows = await ctx.prisma.anomalyAlert.findMany({
        where: { organizationId: input.organizationId },
        orderBy: { detectedAt: "desc" },
        take: input.limit,
      });
      return rows.map((row) => ({
        id: row.id,
        ruleId: row.ruleId,
        ruleName: row.ruleName,
        ruleType: row.ruleType,
        severity: row.severity as "critical" | "warning" | "info",
        triggerWindowStartIso: row.triggerWindowStart.toISOString(),
        triggerWindowEndIso: row.triggerWindowEnd.toISOString(),
        triggerSpendUsd: row.triggerSpendUsd
          ? Number(row.triggerSpendUsd.toString())
          : null,
        triggerEventCount: row.triggerEventCount,
        detectedAtIso: row.detectedAt.toISOString(),
        state: row.state,
        currentState: row.state as "open" | "acknowledged" | "resolved",
        detail: row.detail as Record<string, unknown>,
        // Back-compat aliases for the existing /governance dashboard
        // (renderer was sketched against the iter-10 mock shape).
        rule: row.ruleName,
        sourceLabel: extractSourceLabel(row.detail),
      }));
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
