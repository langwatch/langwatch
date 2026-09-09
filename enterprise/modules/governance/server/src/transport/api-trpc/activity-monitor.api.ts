/**
 * Activity Monitor read-side tRPC surface — powers the /governance admin
 * dashboard (summary cards, spend rollups, spend-over-time, anomaly alerts,
 * per-source health).
 *
 * Every procedure is read-only, gated on `activityMonitor:view` (org ADMIN or
 * a custom role granting it), and additionally wrapped by a `planGate`
 * decorator the composition supplies — the whole surface is enterprise-only,
 * and the gate refuses with the specific feature-name refusal a non-enterprise
 * caller sees.
 *
 * Transport only: input parsing, delegation, wire shape. The rollups belong
 * to `GovernanceService`; the plan gate belongs to the composition.
 *
 * Spec: specs/ai-gateway/governance/activity-monitor.feature
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  activityEventDetailRowSchema,
  activityMonitorSummarySchema,
  ingestionSourceHealthRowSchema,
  recentAnomalyRowSchema,
  sourceHealthMetricsSchema,
  spendByDepartmentRowSchema,
  spendByTeamRowSchema,
  spendByUserRowSchema,
  spendOverTimeResultSchema,
  type GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

export type ActivityMonitorTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
}>;

type ActivityMonitorTrpcProcedures<
  TContext extends ActivityMonitorTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
  /**
   * Refuses the call when the caller's organization is not on an enterprise
   * plan. Composition supplies one gate per feature identifier — this
   * surface's identifier is `ACTIVITY_MONITOR`.
   */
  planGate: TrpcPolicyDecorator;
}>;

const organizationScope = z.object({ organizationId: z.string() });
const windowDays = z.number().int().min(1).max(365).default(30);
const paginationAndSort = {
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
  sortBy: z.enum(["spend", "requests", "lastActivity"]).default("spend"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
} as const;

const summarySchema = organizationScope.extend({ windowDays });
const spendByEntitySchema = organizationScope.extend({ windowDays, ...paginationAndSort });
const spendByDepartmentSchema = organizationScope.extend({ windowDays });
const spendOverTimeSchema = organizationScope.extend({
  windowDays,
  groupBy: z.enum(["team", "user", "model"]).default("team"),
});
const recentAnomaliesSchema = organizationScope.extend({
  limit: z.number().int().min(1).max(200).default(50),
});
const sourceScopeSchema = organizationScope.extend({ sourceId: z.string() });
const eventsForSourceSchema = sourceScopeSchema.extend({
  limit: z.number().int().min(1).max(200).default(50),
  beforeIso: z.string().optional(),
});

/** Installs the `activityMonitor.*` tRPC surface on a process root. */
export class ActivityMonitorTrpcApi {
  static create<
    TContext extends ActivityMonitorTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: ActivityMonitorTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, planGate, validateOutput } = procedures;

    // Every declaration composes as `policy(planGate(<parsed procedure>))`. The
    // chain applies the parser first so the plan gate can read
    // `input.organizationId`, then the plan gate, then the policy (tracing,
    // logging, error shaping, scope lineage, authz, audit).
    const activityMonitorViewer = policy("activityMonitor:view");
    const declare: TrpcPolicyDecorator = (built) => activityMonitorViewer(planGate(built));
    const REASON =
      "activityMonitor:view, then the enterprise plan gate carrying the ACTIVITY_MONITOR refusal copy";

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("summary", (p) =>
        p
          .withInput(summarySchema)
          .withOutput(activityMonitorSummarySchema)
          .withCustomPermission(declare, REASON)
          /**
           * Summary cards: total spend in the window, the delta against the
           * previous one, users, and the anomaly breakdown.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.activitySummary({
              organizationId: input.organizationId,
              windowDays: input.windowDays,
            }),
          ),
      )
      .query("spendByUser", (p) =>
        p
          .withInput(spendByEntitySchema)
          .withOutput(spendByUserRowSchema.array())
          .withCustomPermission(declare, REASON)
          /**
           * Per-user spend breakdown; the defaults match the top-N bird's-eye
           * card, and pagination and sort back the view-all listing page.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.activitySpendByUser({
              organizationId: input.organizationId,
              windowDays: input.windowDays,
              limit: input.limit,
              offset: input.offset,
              sortBy: input.sortBy,
              sortDir: input.sortDir,
            }),
          ),
      )
      .query("spendByTeam", (p) =>
        p
          .withInput(spendByEntitySchema)
          .withOutput(spendByTeamRowSchema.array())
          .withCustomPermission(declare, REASON)
          /**
           * Per-team spend rollup, with an "Org-wide" bucket for sources that
           * name no team. Pairs with `spendByUser` on the admin bird's-eye home.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.activitySpendByTeam({
              organizationId: input.organizationId,
              windowDays: input.windowDays,
              limit: input.limit,
              offset: input.offset,
              sortBy: input.sortBy,
              sortDir: input.sortDir,
            }),
          ),
      )
      .query("spendByDepartment", (p) =>
        p
          .withInput(spendByDepartmentSchema)
          .withOutput(spendByDepartmentRowSchema.array())
          .withCustomPermission(declare, REASON)
          /**
           * Spend rolled up by department across every project in the
           * organization — the marketing-versus-engineering comparison,
           * including personal AI use. Reads the whole organization's spend,
           * not only the governance ingestion silo.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.activitySpendByDepartment({
              organizationId: input.organizationId,
              windowDays: input.windowDays,
            }),
          ),
      )
      .query("spendOverTime", (p) =>
        p
          .withInput(spendOverTimeSchema)
          .withOutput(spendOverTimeResultSchema)
          .withCustomPermission(declare, REASON)
          /**
           * Daily spend-over-time buckets grouped by team, user or model —
           * bucket-major so the chart iterates days directly. An empty day
           * emits `points: []` so the X axis stays dense.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.activitySpendOverTime({
              organizationId: input.organizationId,
              windowDays: input.windowDays,
              groupBy: input.groupBy,
            }),
          ),
      )
      .query("ingestionSourcesHealth", (p) =>
        p
          .withInput(organizationScope)
          .withOutput(ingestionSourceHealthRowSchema.array())
          .withCustomPermission(declare, REASON)
          /** Per-source health for the dashboard's source strip. */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.activityIngestionSourcesHealth({
              organizationId: input.organizationId,
            }),
          ),
      )
      .query("recentAnomalies", (p) =>
        p
          .withInput(recentAnomaliesSchema)
          .withOutput(recentAnomalyRowSchema.array())
          .withCustomPermission(declare, REASON)
          /**
           * Recent alerts produced by the anomaly-detection subscriber. Answers
           * `[]` when no rule has fired and when ClickHouse is disabled — the
           * subscriber short-circuits without it.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.activityRecentAnomalies({
              organizationId: input.organizationId,
              limit: input.limit,
            }),
          ),
      )
      .query("eventsForSource", (p) =>
        p
          .withInput(eventsForSourceSchema)
          .withOutput(activityEventDetailRowSchema.array())
          .withCustomPermission(declare, REASON)
          /**
           * Recent events for one IngestionSource — the per-source detail
           * page's "raw versus normalised" preview, cursor-paginated by
           * `eventTimestamp DESC` through `beforeIso`.
           */
          .handle(async ({ ctx, input }) => ctx.app.governance.activityEventsForSource(input)),
      )
      .query("sourceHealthMetrics", (p) =>
        p
          .withInput(sourceScopeSchema)
          .withOutput(sourceHealthMetricsSchema)
          .withCustomPermission(declare, REASON)
          /**
           * Volume metrics for one source over rolling 24-hour, 7-day and
           * 30-day windows, plus `lastSuccessIso`. The per-source detail page's
           * health header.
           */
          .handle(async ({ ctx, input }) => ctx.app.governance.activitySourceHealthMetrics(input)),
      )
      .build();
  }
}
