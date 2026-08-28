/**
 * A dashboard's chart-builder graphs over a host's tRPC transport.
 *
 *   create:             a new chart on a dashboard, at a grid position.
 *   getAll:             the project's charts, each with the alert automation
 *                       watching it, if any.
 *   getById:            one chart, with its validated filters and the alert
 *                       the bell icon in its header edits.
 *   delete:             one chart.
 *   updateById:         a chart's name, payload and filters.
 *   updateLayout:       one chart's grid position.
 *   batchUpdateLayouts: the whole grid after a drag.
 *
 * Reading takes `analytics:view`; creating takes `analytics:create`, editing
 * `analytics:update`, and removing `analytics:delete`.
 *
 * Alert WRITING is not here: it lives on `automation.upsert` with a
 * `customGraphId` as of ADR-034 Phase 5.2, and the bell opens the automations
 * drawer. This surface only reads the persisted graph-alert trigger back.
 *
 * Transport only: policy, error translation, and delegation to
 * `DashboardService`.
 *
 * Spec: packages/features/dashboard/specs/dashboard-service.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { Trigger } from "@langwatch/automation-contract";
import {
  DashboardNotFoundError,
  GraphNotFoundError,
  type Graph,
  type DashboardService,
} from "@langwatch/dashboard-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/**
 * The alert reads this surface makes on the Automation feature.
 *
 * Declared as the two methods it calls rather than the whole automation
 * service: a chart card shows the trigger watching it, and depends on nothing
 * else Automation owns.
 */
type GraphAlertLookup = Readonly<{
  getByCustomGraphIds(
    input: Readonly<{ projectId: string; customGraphIds: string[] }>,
  ): Promise<Trigger[]>;
  tryGetByCustomGraphId(
    input: Readonly<{ projectId: string; customGraphId: string }>,
  ): Promise<Trigger | null>;
}>;

type GraphApplication = Readonly<{
  dashboard: DashboardService;
  automation: GraphAlertLookup;
}>;

/** The host supplies authentication; authorization arrives as `policy`. */
export type GraphTrpcContext = Readonly<{ app: GraphApplication }>;

type GraphTrpcProcedures<
  TContext extends GraphTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The host's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The host's tracing, logging, error, scope-lineage, authorization and audit
   * policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The host capabilities this transport needs that are not Dashboard's own.
 */
export type GraphTrpcPorts<TFilterField extends string> = Readonly<{
  /**
   * The filter fields a stored graph may name. Injected because the catalogue
   * of filterable trace fields belongs to the host's filter registry, not to
   * Dashboard: a graph stores whatever the builder wrote, and this is what
   * decides which of those keys are still real when the graph is read back.
   */
  filterFieldSchema: z.ZodType<TFilterField>;
  /**
   * Strips the provider secrets an alert's `actionParams` carries — the
   * encrypted Slack bot token (ADR-041), webhook header values (ADR-040 §3) —
   * per the trigger's own action, before the row leaves the server.
   */
  redactActionParams(
    action: Trigger["action"],
    actionParams: Record<string, unknown>,
  ): Record<string, unknown>;
}>;

/** Compatibility shape: the old Prisma transport exposed the discriminator. */
const legacyGraph = <T extends Graph>(graph: T) => ({ ...graph, kind: "builder" as const });

/**
 * Read-side hydration shape for the `Add / Edit alert` bell icon on the graph
 * card header.
 */
interface AlertActionParams {
  members?: string[];
  slackWebhook?: string;
  seriesName?: string;
}

/**
 * Translates the two dashboard domain errors this surface can raise, and hands
 * everything else back untouched.
 */
function mapGraphError(error: unknown): never {
  if (error instanceof GraphNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
  }
  if (error instanceof DashboardNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Dashboard not found" });
  }
  throw error;
}

async function graphCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    mapGraphError(error);
  }
}

const layoutShape = {
  gridColumn: z.number().min(0).max(1),
  gridRow: z.number().min(0),
  colSpan: z.number().min(1).max(2),
  rowSpan: z.number().min(1).max(2),
};

/**
 * Installs the complete `graphs.*` tRPC surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 */
export class GraphTrpcApi {
  static create<
    TContext extends GraphTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TFilterField extends string,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GraphTrpcProcedures<TContext, TOptions, TRoot>,
    ports: GraphTrpcPorts<TFilterField>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      create: policy("analytics:create")(
        procedure.input(
          z.object({
            projectId: z.string(),
            name: z.string(),
            graph: z.string(),
            filterParams: z.any().optional(),
            dashboardId: z.string().optional(),
            gridColumn: layoutShape.gridColumn.optional(),
            gridRow: layoutShape.gridRow.optional(),
            colSpan: layoutShape.colSpan.optional(),
            rowSpan: layoutShape.rowSpan.optional(),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const graph = JSON.parse(input.graph) as Record<string, unknown>;

        return legacyGraph(
          await graphCall(() =>
            ctx.app.dashboard.createGraph({
              projectId: input.projectId,
              name: input.name,
              graph,
              filters: input.filterParams?.filters ?? {},
              ...(input.dashboardId === undefined ? {} : { dashboardId: input.dashboardId }),
              layout: {
                gridColumn: input.gridColumn ?? 0,
                ...(input.gridRow === undefined ? {} : { gridRow: input.gridRow }),
                colSpan: input.colSpan ?? 1,
                rowSpan: input.rowSpan ?? 1,
              },
            }),
          ),
        );
      }),

      /**
       * `listGraphs` returns chart-builder rows only, so a member's stored
       * LangWatchQL definition never reaches this payload — the service filters
       * on the kind discriminator, which is why nothing is stripped here.
       */
      getAll: policy("analytics:view")(
        procedure.input(
          z.object({ projectId: z.string(), dashboardId: z.string().optional() }),
        ),
      ).query(async ({ ctx, input }) => {
        const { projectId, dashboardId } = input;
        const graphs = await graphCall(() =>
          ctx.app.dashboard.listGraphs({
            projectId,
            ...(dashboardId === undefined ? {} : { dashboardId }),
          }),
        );

        const triggers = await ctx.app.automation.getByCustomGraphIds({
          projectId,
          customGraphIds: graphs.map((graph) => graph.id),
        });
        const triggerByGraphId = new Map(
          triggers.flatMap((trigger) =>
            trigger.customGraphId === null ? [] : [[trigger.customGraphId, trigger] as const],
          ),
        );

        return graphs.map((graph) => {
          const trigger = triggerByGraphId.get(graph.id) ?? null;
          return {
            ...legacyGraph(graph),
            trigger: trigger
              ? {
                  ...trigger,
                  actionParams: ports.redactActionParams(
                    trigger.action,
                    (trigger.actionParams ?? {}) as Record<string, unknown>,
                  ),
                }
              : null,
          };
        });
      }),

      delete: policy("analytics:delete")(
        procedure.input(z.object({ projectId: z.string(), id: z.string() })),
      ).mutation(
        async ({ ctx, input }) =>
          legacyGraph(
            await graphCall(() =>
              ctx.app.dashboard.deleteGraph({ projectId: input.projectId, graphId: input.id }),
            ),
          ),
      ),

      getById: policy("analytics:view")(
        procedure.input(z.object({ projectId: z.string(), id: z.string() })),
      ).query(async ({ ctx, input }) => {
        const graph = await graphCall(() =>
          ctx.app.dashboard.getGraph({ projectId: input.projectId, graphId: input.id }),
        );

        // Basic validation to ensure filters have the expected structure: a
        // stored graph can name a field the registry no longer offers.
        let validatedFilters:
          | Record<TFilterField, string[] | Record<string, string[]>>
          | undefined;

        if (graph.filters && typeof graph.filters === "object") {
          const validFilters: Record<string, unknown> = {};

          for (const [key, value] of Object.entries(graph.filters)) {
            if (ports.filterFieldSchema.safeParse(key).success) {
              if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
                validFilters[key] = value;
              }
            }
          }

          validatedFilters =
            Object.keys(validFilters).length > 0
              ? (validFilters as Record<TFilterField, string[] | Record<string, string[]>>)
              : undefined;
        }

        const trigger = await ctx.app.automation.tryGetByCustomGraphId({
          customGraphId: input.id,
          projectId: input.projectId,
        });

        let alertData = undefined;
        if (trigger?.active && !trigger.deleted) {
          const actionParams = trigger.actionParams as unknown as AlertActionParams & {
            threshold: number;
            operator: string;
            timePeriod: number;
          };
          alertData = {
            enabled: true,
            threshold: actionParams.threshold,
            operator: actionParams.operator,
            timePeriod: actionParams.timePeriod,
            seriesName: actionParams.seriesName || "",
            type: trigger.alertType,
            action: trigger.action,
            actionParams: {
              members: actionParams.members,
              slackWebhook: actionParams.slackWebhook,
              seriesName: actionParams.seriesName,
            },
            triggerId: trigger.id,
          };
        }

        return { ...legacyGraph(graph), filters: validatedFilters, alert: alertData };
      }),

      updateById: policy("analytics:update")(
        procedure.input(
          z.object({
            projectId: z.string(),
            name: z.string(),
            graph: z.string(),
            graphId: z.string(),
            filterParams: z.any().optional(),
          }),
        ),
      ).mutation(
        async ({ ctx, input }) =>
          legacyGraph(
            await graphCall(() =>
              ctx.app.dashboard.updateGraph({
                projectId: input.projectId,
                graphId: input.graphId,
                name: input.name,
                graph: JSON.parse(input.graph) as Record<string, unknown>,
                filters: input.filterParams?.filters ?? {},
              }),
            ),
          ),
      ),

      updateLayout: policy("analytics:update")(
        procedure.input(
          z.object({ projectId: z.string(), graphId: z.string(), ...layoutShape }),
        ),
      ).mutation(
        async ({ ctx, input }) =>
          legacyGraph(
            await graphCall(() =>
              ctx.app.dashboard.updateGraphLayout({
                projectId: input.projectId,
                graphId: input.graphId,
                layout: {
                  gridColumn: input.gridColumn,
                  gridRow: input.gridRow,
                  colSpan: input.colSpan,
                  rowSpan: input.rowSpan,
                },
              }),
            ),
          ),
      ),

      batchUpdateLayouts: policy("analytics:update")(
        procedure.input(
          z.object({
            projectId: z.string(),
            layouts: z.array(z.object({ graphId: z.string(), ...layoutShape })),
          }),
        ),
      ).mutation(
        async ({ ctx, input }) =>
          await graphCall(() =>
            ctx.app.dashboard.batchUpdateGraphLayouts({
              projectId: input.projectId,
              layouts: input.layouts.map((layout) => ({
                graphId: layout.graphId,
                layout: {
                  gridColumn: layout.gridColumn,
                  gridRow: layout.gridRow,
                  colSpan: layout.colSpan,
                  rowSpan: layout.rowSpan,
                },
              })),
            }),
          ),
      ),
    });
  }
}
