/**
 * Saved LangWatchQL workbench charts over a host's tRPC transport.
 *
 *   getAll:  every saved chart in the project.
 *   getById: one chart, with its query, parameters and specification.
 *   create:  a new chart.
 *   update:  a chart's name, its definition, or both.
 *   run:     one saved chart, executed for the period the surface asks for.
 *   delete:  one chart.
 *
 * Thin by design. Every procedure does the same four things and nothing else:
 * check the member may do this, check the surface is switched on, resolve who
 * is asking, and hand the request to the service. The first two are declared
 * rather than written out, so a seventh procedure cannot be added with either
 * quietly missing.
 *
 * ## Why `definition` is `unknown` here
 *
 * The versioned definition schema lives with the service, which is the only
 * thing that writes a row. Re-declaring it in the input would put the same
 * decision in two places, and the moment they drift the transport wins —
 * admitting a definition the service would refuse, or refusing one it would
 * keep. The service raises a `validation_error` carrying `meta.fieldErrors`,
 * which is what a form binds to, so nothing is lost by deciding it one layer
 * down.
 *
 * Handled errors propagate untouched: the host's tRPC boundary serialises a
 * `HandledError` into its code plus `meta`, and the workbench renders registry
 * copy keyed by that code. Catching and rewrapping here would replace a refusal
 * the member can act on with one they cannot.
 *
 * Spec: specs/analytics/lwql-saved-charts.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type {
  LangWatchQLCaller,
  LangWatchQLProtections,
  LangWatchQLTimeWindow,
} from "@langwatch/analytics-contract";
import type { DashboardService } from "@langwatch/dashboard-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

type SavedWorkbenchChartApplication = Readonly<{ dashboard: DashboardService }>;

/** The host supplies authentication; authorization arrives as `policy`. */
export type SavedWorkbenchChartTrpcContext = Readonly<{
  app: SavedWorkbenchChartApplication;
}>;

type SavedWorkbenchChartTrpcProcedures<
  TContext extends SavedWorkbenchChartTrpcContext,
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
export type SavedWorkbenchChartTrpcPorts = Readonly<{
  /**
   * The workbench's experimental switch, chained AFTER the permission check so
   * a caller is placed by RBAC first and gated by the rollout second: a member
   * who may not touch the project should not learn from the answer whether the
   * experiment is switched on for it. Reads refuse too, and deliberately — a
   * surface that listed charts while it was switched off would announce a
   * feature the same member cannot use.
   */
  requireWorkbenchEnabled<TProcedure>(procedure: TProcedure): TProcedure;
  /**
   * The period a caller reports over, as every door accepts it — injected from
   * the one schema the tRPC and REST doors share, so a constraint added at one
   * cannot quietly give the same saved chart a second meaning at the other.
   */
  timeWindowSchema: z.ZodType<LangWatchQLTimeWindow>;
  /**
   * The datapoint steps this deployment offers, so an off-list value is a
   * schema rejection here rather than reaching the service's backstop. The
   * bucket-budget arithmetic and its refusal are still the service's.
   */
  granularityStepSchema: z.ZodType<number>;
  /** The member's own content protections for this project. */
  resolveProtections(
    ctx: SavedWorkbenchChartTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<LangWatchQLProtections>;
  /**
   * The project identity and protections a session-authenticated execution
   * runs under. The project's LangWatchQL secret is hashed into the tenant
   * capability the query runs as: it is read server-side and must never leave
   * the calling procedure.
   */
  resolveRunCaller(
    ctx: SavedWorkbenchChartTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<Readonly<{ project: LangWatchQLCaller; protections: LangWatchQLProtections }>>;
  /**
   * Admits a definition against the caller's own protections before it is
   * stored, and hands back the definition to store.
   *
   * Kept at the transport rather than left to the service's policy because
   * this is the one place the CALLER's protections are known: a member who
   * cannot read costs must not be able to save a chart that selects them,
   * whatever a process-wide policy would have admitted.
   */
  admitDefinition(
    ctx: SavedWorkbenchChartTrpcContext,
    input: Readonly<{
      projectId: string;
      protections: LangWatchQLProtections;
      definition: unknown;
    }>,
  ): unknown;
  /** Keeps the existing handled-error response envelopes stable. */
  mapError(error: unknown): never;
}>;

const projectScopeSchema = z.object({ projectId: z.string() });
const chartScopeSchema = projectScopeSchema.extend({ id: z.string() });

/** Request shape only — length, not meaning. */
const nameSchema = z.string().min(1).max(200);

/**
 * Installs the complete saved-workbench-chart tRPC surface on a host-owned
 * root. The procedure and the policy are injected by the host so its auth,
 * audit, error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class SavedWorkbenchChartTrpcApi {
  static create<
    TContext extends SavedWorkbenchChartTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SavedWorkbenchChartTrpcProcedures<TContext, TOptions, TRoot>,
    ports: SavedWorkbenchChartTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;
    const { requireWorkbenchEnabled } = ports;

    const call = async <T>(run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (error) {
        ports.mapError(error);
      }
    };

    return trpc.router({
      getAll: requireWorkbenchEnabled(
        policy("analytics:view")(procedure.input(projectScopeSchema)),
      ).query(
        async ({ ctx, input }) =>
          await call(() =>
            ctx.app.dashboard.listSavedWorkbenchCharts({ projectId: input.projectId }),
          ),
      ),

      getById: requireWorkbenchEnabled(
        policy("analytics:view")(procedure.input(chartScopeSchema)),
      ).query(
        async ({ ctx, input }) =>
          await call(() =>
            ctx.app.dashboard.getSavedWorkbenchChart({
              chartId: input.id,
              projectId: input.projectId,
            }),
          ),
      ),

      create: requireWorkbenchEnabled(
        policy("analytics:create")(
          procedure.input(
            projectScopeSchema.extend({ name: nameSchema, definition: z.unknown() }),
          ),
        ),
      ).mutation(async ({ ctx, input }) => {
        const protections = await ports.resolveProtections(ctx, {
          projectId: input.projectId,
        });
        const definition = ports.admitDefinition(ctx, {
          projectId: input.projectId,
          protections,
          definition: input.definition,
        });
        return await call(() =>
          ctx.app.dashboard.createSavedWorkbenchChart({
            projectId: input.projectId,
            protections,
            name: input.name,
            definition,
          }),
        );
      }),

      /**
       * The author's protections are resolved for THIS request rather than
       * remembered from the save, so a member whose permissions narrowed cannot
       * update a chart into naming a column they may no longer read.
       */
      update: requireWorkbenchEnabled(
        policy("analytics:update")(
          procedure.input(
            chartScopeSchema.extend({
              name: nameSchema.optional(),
              definition: z.unknown().optional(),
            }),
          ),
        ),
      ).mutation(async ({ ctx, input }) => {
        const definitionUpdate =
          input.definition === undefined
            ? undefined
            : await (async () => {
                const protections = await ports.resolveProtections(ctx, {
                  projectId: input.projectId,
                });
                return {
                  protections,
                  definition: ports.admitDefinition(ctx, {
                    projectId: input.projectId,
                    protections,
                    definition: input.definition,
                  }),
                };
              })();

        return await call(() =>
          ctx.app.dashboard.updateSavedWorkbenchChart({
            chartId: input.id,
            projectId: input.projectId,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(definitionUpdate === undefined ? {} : { definitionUpdate }),
          }),
        );
      }),

      /**
       * Running is reading with execution attached, so it is a sibling of
       * `getById` rather than a new surface, chained through the same permission
       * and switch gates. The period and the datapoint step are supplied by this
       * request, never read out of the stored definition: they are the surface's
       * to set, which is the whole reserved-parameter contract.
       *
       * `onBudgetOverflow` defaults to refusing, so every existing caller keeps
       * the behaviour it had. A dashboard widget passes `"coarsen"` because its
       * saved step meets whatever period the dashboard's control is set to:
       * refusing there would blank a card whose owner changed nothing. The
       * substitution is reported back as `coarsenedFromSeconds` rather than
       * applied silently.
       */
      run: requireWorkbenchEnabled(
        policy("analytics:view")(
          procedure.input(
            chartScopeSchema.extend({
              timeWindow: ports.timeWindowSchema.optional(),
              granularitySeconds: ports.granularityStepSchema.optional(),
              onBudgetOverflow: z.enum(["refuse", "coarsen"]).optional(),
            }),
          ),
        ),
      ).mutation(async ({ ctx, input }) => {
        const { project, protections } = await ports.resolveRunCaller(ctx, {
          projectId: input.projectId,
        });

        return await call(() =>
          ctx.app.dashboard.runSavedWorkbenchChart({
            chartId: input.id,
            projectId: input.projectId,
            execution: {
              project,
              protections,
              ...(input.timeWindow ? { timeWindow: input.timeWindow } : {}),
              ...(input.granularitySeconds === undefined
                ? {}
                : { granularitySeconds: input.granularitySeconds }),
              ...(input.onBudgetOverflow
                ? { onBudgetOverflow: input.onBudgetOverflow }
                : {}),
            },
          }),
        );
      }),

      delete: requireWorkbenchEnabled(
        policy("analytics:delete")(procedure.input(chartScopeSchema)),
      ).mutation(async ({ ctx, input }) => {
        await call(() =>
          ctx.app.dashboard.deleteSavedWorkbenchChart({
            chartId: input.id,
            projectId: input.projectId,
          }),
        );
        return { success: true };
      }),
    });
  }
}
