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
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

export type ActivityMonitorTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type ActivityMonitorTrpcProcedures<
  TContext extends ActivityMonitorTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): ProcedureDecorator;
  /**
   * Refuses the call when the caller's organization is not on an enterprise
   * plan. Composition supplies one gate per feature identifier — this
   * surface's identifier is `ACTIVITY_MONITOR`.
   */
  planGate: ProcedureDecorator;
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
    const { protected: procedure, policy, planGate } = procedures;

    // Every declaration composes as `policy(planGate(procedure.input(schema)))`.
    // `.input` first so the plan gate can read `input.organizationId`, then
    // `planGate`, then `policy` (tracing, logging, error shaping, scope
    // lineage, authz, audit). One helper because every read shares the shape.
    const declare = <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
      policy("activityMonitor:view")(planGate(procedure.input(schema)));

    return trpc.router({
      /** Summary cards: total spend in window, delta vs previous, users, anomaly breakdown. */
      summary: declare(summarySchema).query(async ({ ctx, input }) =>
        ctx.app.governance.activitySummary({
          organizationId: input.organizationId,
          windowDays: input.windowDays,
        }),
      ),

      /**
       * Per-user spend breakdown; defaults match the top-N bird's-eye card.
       * Pagination + sort back the View-all-users listing page.
       */
      spendByUser: declare(spendByEntitySchema).query(async ({ ctx, input }) =>
        ctx.app.governance.activitySpendByUser({
          organizationId: input.organizationId,
          windowDays: input.windowDays,
          limit: input.limit,
          offset: input.offset,
          sortBy: input.sortBy,
          sortDir: input.sortDir,
        }),
      ),

      /**
       * Per-team spend rollup (with an "Org-wide" bucket for null-teamId
       * sources). Pairs with `spendByUser` for the admin bird's-eye home.
       */
      spendByTeam: declare(spendByEntitySchema).query(async ({ ctx, input }) =>
        ctx.app.governance.activitySpendByTeam({
          organizationId: input.organizationId,
          windowDays: input.windowDays,
          limit: input.limit,
          offset: input.offset,
          sortBy: input.sortBy,
          sortDir: input.sortDir,
        }),
      ),

      /**
       * Spend rolled up by department across every project in the org — the
       * marketing-versus-engineering comparison, including personal AI use.
       * Reads the whole org's spend, not just the governance ingestion silo.
       */
      spendByDepartment: declare(spendByDepartmentSchema).query(async ({ ctx, input }) =>
        ctx.app.governance.activitySpendByDepartment({
          organizationId: input.organizationId,
          windowDays: input.windowDays,
        }),
      ),

      /**
       * Daily spend-over-time buckets, grouped by team, user or model —
       * bucket-major envelope so the chart iterates days directly. Empty
       * days emit `points: []` so the X axis stays dense.
       */
      spendOverTime: declare(spendOverTimeSchema).query(async ({ ctx, input }) =>
        ctx.app.governance.activitySpendOverTime({
          organizationId: input.organizationId,
          windowDays: input.windowDays,
          groupBy: input.groupBy,
        }),
      ),

      /** Per-source health for the dashboard's source strip. */
      ingestionSourcesHealth: declare(organizationScope).query(async ({ ctx, input }) =>
        ctx.app.governance.activityIngestionSourcesHealth({
          organizationId: input.organizationId,
        }),
      ),

      /**
       * Recent alerts produced by the anomaly-detection subscriber. Returns
       * `[]` when no rules have fired or when ClickHouse is disabled (the
       * subscriber short-circuits without CH).
       */
      recentAnomalies: declare(recentAnomaliesSchema).query(async ({ ctx, input }) =>
        ctx.app.governance.activityRecentAnomalies({
          organizationId: input.organizationId,
          limit: input.limit,
        }),
      ),

      /**
       * Recent events for a single IngestionSource — powers the per-source
       * detail page's "raw vs normalised" preview, cursor-paginated by
       * `eventTimestamp DESC` via `beforeIso`.
       */
      eventsForSource: declare(eventsForSourceSchema).query(async ({ ctx, input }) =>
        ctx.app.governance.activityEventsForSource(input),
      ),

      /**
       * Volume metrics for one source over rolling 24h/7d/30d windows plus
       * `lastSuccessIso`. Powers the per-source detail page's health header.
       */
      sourceHealthMetrics: declare(sourceScopeSchema).query(async ({ ctx, input }) =>
        ctx.app.governance.activitySourceHealthMetrics(input),
      ),
    });
  }
}
