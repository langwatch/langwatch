// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for the Activity Monitor read-side queries that power
 * the /governance admin dashboard. Replaces Alexis's MOCK_* fixtures
 * with real data from gateway_activity_events (CH) + IngestionSource
 * (PG).
 *
 * RBAC: read-only - all procedures gate on `activityMonitor:view`
 * per the catalog in api/rbac.ts. Only org ADMIN (or a custom role
 * granting it) sees the dashboard. MEMBER + EXTERNAL roles get nothing
 * by default - the previous `organization:view` gate leaked all spend
 * + anomaly + ingestion-health views to every org member.
 *
 * Spec: specs/ai-gateway/governance/activity-monitor.feature
 */

import { z } from "zod";

import {
  ENTERPRISE_FEATURE_ERRORS,
  requireEnterprisePlan,
} from "~/server/api/enterprise";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";

const enterpriseGate = requireEnterprisePlan(ENTERPRISE_FEATURE_ERRORS.ACTIVITY_MONITOR);

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
    .permission("activityMonitor:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      return await service.activitySummary({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
      });
    }),

  /**
   * Per-user spend breakdown (top-N or paginated).
   *
   * Default `limit=50`, `offset=0`, `sortBy='spend'`, `sortDir='desc'`
   * → backwards-compat with the bird's-eye top-N capture. Pagination +
   * sort args back the View-all-users listing page.
   */
  spendByUser: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
        sortBy: z.enum(["spend", "requests", "lastActivity"]).default("spend"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .permission("activityMonitor:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      return await service.activitySpendByUser({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
        limit: input.limit,
        offset: input.offset,
        sortBy: input.sortBy,
        sortDir: input.sortDir,
      });
    }),

  /**
   * Per-team spend rollup. Aggregates ingestion-source events by the
   * source's `teamId` (with an "Org-wide" bucket for null-teamId
   * sources). Pairs with `spendByUser` for the admin bird's-eye home.
   *
   * Default args match `spendByUser` → backwards-compat top-N capture;
   * pagination + sort back the View-all-teams listing page.
   */
  spendByTeam: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
        sortBy: z.enum(["spend", "requests", "lastActivity"]).default("spend"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .permission("activityMonitor:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      return await service.activitySpendByTeam({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
        limit: input.limit,
        offset: input.offset,
        sortBy: input.sortBy,
        sortDir: input.sortDir,
      });
    }),

  /**
   * Spend rolled up by department across every project in the org.
   * Powers the bird's-eye "Spend by department" card and answers the
   * marketing-versus-engineering comparison, including personal AI use.
   * Unlike `spendByUser`/`spendByTeam` this reads the whole org's spend,
   * not just the governance ingestion silo.
   *
   * Spec: specs/ai-gateway/governance/departments.feature
   */
  spendByDepartment: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
      }),
    )
    .permission("activityMonitor:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      return await service.activitySpendByDepartment({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
      });
    }),

  /**
   * Spend-over-time daily buckets, grouped by team / user / model.
   * Powers the bird's-eye `<SpendOverTimeChart>` (Recharts stacked
   * area). Bucket-major envelope so the chart can iterate days
   * directly; `points: []` is emitted for empty days so the X axis
   * is dense (no Recharts stack-id rendering gaps).
   *
   * Spec: specs/ai-gateway/governance/birds-eye-dashboard-v2.feature
   */
  spendOverTime: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        windowDays: z.number().int().min(1).max(365).default(30),
        groupBy: z.enum(["team", "user", "model"]).default("team"),
      }),
    )
    .permission("activityMonitor:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      return await service.activitySpendOverTime({
        organizationId: input.organizationId,
        windowDays: input.windowDays,
        groupBy: input.groupBy,
      });
    }),

  /**
   * Per-source health metrics for the dashboard's source strip.
   */
  ingestionSourcesHealth: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("activityMonitor:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      return await service.activityIngestionSourcesHealth({
        organizationId: input.organizationId,
      });
    }),

  /**
   * Recent anomaly alerts produced by the anomaly-detection subscriber.
   * Service-routed read of `prisma.anomalyAlert` keyed by org, sorted
   * by detectedAt DESC. Returns [] when no rules have fired or when
   * ClickHouse is disabled (the subscriber short-circuits without CH).
   */
  recentAnomalies: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .permission("activityMonitor:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      return await service.activityRecentAnomalies({
        organizationId: input.organizationId,
        limit: input.limit,
      });
    }),

  /**
   * Recent events for a single IngestionSource - powers the per-source
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
    .permission("activityMonitor:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      return await service.activityEventsForSource(input);
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
    .permission("activityMonitor:view")
    .use(enterpriseGate)
    .query(async ({ ctx, input }) => {
      const service = ctx.app.governance;
      return await service.activitySourceHealthMetrics(input);
    }),
});
