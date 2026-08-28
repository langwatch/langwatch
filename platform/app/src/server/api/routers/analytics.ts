/**
 * Process wiring for the `analytics.*` tRPC surface.
 *
 * Three transports meet under one namespace, and all three are package-owned:
 * the Analytics reads and the LangWatchQL workbench from
 * `@langwatch/analytics-server`, and the saved workbench charts from
 * `@langwatch/dashboard-server` — which is where the `saved-workbench-chart`
 * subject lives even though the surface a member reaches it through is this
 * one. All three are mounted through `@langwatch/platform-api/app-trpc`.
 *
 * What is left here is the composition this application still owns: its tRPC
 * root, its authenticated procedure, its authorization middlewares, the shared
 * analytics input schemas, the filter catalogue, the LangWatchQL rollout gate,
 * and the caller resolution the restricted executor runs as.
 */
import {
  createAnalyticsTrpcRouter,
  createLangWatchQLTrpcRouter,
  createSavedWorkbenchChartTrpcRouter,
  declaredCheckFrom,
  type AppTrpcPolicyMiddlewares,
} from "@langwatch/platform-api/app-trpc";
import { MAX_LWQL_LENGTH } from "~/server/analytics/lwql";
import { lwqlEnabled } from "~/server/analytics/lwql/access";
import {
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "~/server/analytics/lwql/timeWindowSchema";
import {
  mapDashboardSavedWorkbenchChartError,
  validateSavedWorkbenchChartDefinition,
} from "~/server/analytics/saved-workbench-charts/savedWorkbenchChart.service";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { timeseriesInput } from "../../analytics/registry";
import { sharedFiltersInputSchema } from "../../analytics/types";
import { availableFilters } from "../../filters/registry";
import { filterFieldsEnum } from "../../filters/types";
import type { TRPCContext } from "../trpc.context";
import { appTrpcRoot } from "../trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "../trpc.runtime-policy";
import { scopeLineageGuard } from "../trpc.scope-lineage-middleware";
import { getUserProtectionsForProject } from "../utils";
import { resolveLangWatchQLCaller } from "./analytics/lwqlCaller";
import { enforceWorkbenchEnabled } from "./analytics/workbenchAccessMiddleware";

/** This process's concrete policy chain, in the order the mount applies it. */
const middlewares: AppTrpcPolicyMiddlewares = {
  tracer: tracerMiddleware,
  logger: loggerMiddleware,
  handledError: handledErrorMiddleware,
  scopeLineageGuard,
  declaredCheck: declaredCheckFrom({
    permission: checkDeclaredPermission,
    permissionAny: checkDeclaredPermissionAny,
    noPermission: declaredNoPermission,
    serviceAuthorized: declaredServiceAuthorization,
  }),
  enforceCheck: enforcePermissionCheck,
  auditMutations: auditLogMutations,
};

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that chains the rollout gate onto a builder whose input generics belong
 * to the feature package, so the gate below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * The workbench rollout gate, applied AFTER the policy so a caller is placed by
 * RBAC first and gated by the experiment second.
 */
const requireWorkbenchEnabled = <TProcedure>(procedure: TProcedure): TProcedure =>
  (procedure as unknown as ChainableProcedure).use(
    enforceWorkbenchEnabled,
  ) as unknown as TProcedure;

/** The one resolution both LangWatchQL doors run their statements as. */
const resolveRunCaller = (ctx: TRPCContext, input: { projectId: string }) =>
  resolveLangWatchQLCaller({ ctx, projectId: input.projectId });

const resolveProtections = (ctx: TRPCContext, input: { projectId: string }) =>
  getUserProtectionsForProject(ctx, { projectId: input.projectId });

const isWorkbenchEnabled = (ctx: TRPCContext, input: { projectId: string }) =>
  lwqlEnabled({
    featureFlags: ctx.app.featureFlags,
    projectId: input.projectId,
    projects: ctx.app.projects,
  });

/** Exported for the transport's own tests; mounted below as `analytics.lwql`. */
export const lwqlRouter = createLangWatchQLTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    requireWorkbenchEnabled,
    isWorkbenchEnabled,
    maxStatementLength: MAX_LWQL_LENGTH,
    timeWindowSchema: lwqlTimeWindowSchema,
    granularityStepSchema: lwqlGranularityStepSchema,
    resolveProtections,
    resolveRunCaller,
  },
});

/** Exported for the transport's own tests; mounted below as `analytics.savedWorkbenchCharts`. */
export const savedWorkbenchChartsRouter = createSavedWorkbenchChartTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    requireWorkbenchEnabled,
    timeWindowSchema: lwqlTimeWindowSchema,
    granularityStepSchema: lwqlGranularityStepSchema,
    resolveProtections,
    resolveRunCaller,
    // Admitted against the CALLER's own protections before it is stored, which
    // is the one place they are known: a member who cannot read costs must not
    // be able to save a chart that selects them.
    admitDefinition: (ctx: TRPCContext, input) =>
      validateSavedWorkbenchChartDefinition({
        projectId: input.projectId,
        protections: input.protections,
        definition: input.definition,
        lwql: ctx.app.langWatchQL,
      }),
    mapError: mapDashboardSavedWorkbenchChartError,
  },
});

const analyticsReadsRouter = createAnalyticsTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    timeseriesInputSchema: timeseriesInput,
    sharedFiltersSchema: sharedFiltersInputSchema,
    filterFieldSchema: filterFieldsEnum,
    filterFieldRequiresKey: (field) => Boolean(availableFilters[field].requiresKey),
    filterFieldRequiresSubkey: (field) => Boolean(availableFilters[field].requiresSubkey),
  },
});

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const analyticsRouter = appTrpcRoot.mergeRouters(
  analyticsReadsRouter,
  appTrpcRoot.router({
    lwql: lwqlRouter,
    savedWorkbenchCharts: savedWorkbenchChartsRouter,
  }),
);
