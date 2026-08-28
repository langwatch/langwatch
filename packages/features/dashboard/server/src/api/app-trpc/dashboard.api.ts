/**
 * The project's dashboards over a host's tRPC transport.
 *
 *   getAll:            the project's dashboards for the analytics navigation,
 *                      the reports page, the rename drawer and the automation
 *                      subject picker, each with the number of cards its grid
 *                      will render.
 *   getById:           one dashboard with its graphs, in grid order.
 *   create:            a new dashboard, appended after the current last.
 *   rename:            a dashboard's name.
 *   delete:            a dashboard, cascading to its graphs.
 *   reorderDashboards: the order the navigation lists them in.
 *   getOrCreateFirst:  the project's first dashboard, created on demand so a
 *                      project that has never opened analytics still has one.
 *
 * Reading takes `analytics:view`; creating takes `analytics:create`, editing
 * `analytics:update`, and removing `analytics:delete`.
 *
 * Transport only: policy, error translation, and delegation to
 * `DashboardService`.
 *
 * Spec: packages/features/dashboard/specs/dashboard-service.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  DashboardNotFoundError,
  DashboardReorderError,
  type DashboardService,
} from "@langwatch/dashboard-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

type DashboardApplication = Readonly<{ dashboard: DashboardService }>;

/** The host supplies authentication; authorization arrives as `policy`. */
export type DashboardTrpcContext = Readonly<{ app: DashboardApplication }>;

type DashboardTrpcProcedures<
  TContext extends DashboardTrpcContext,
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
 * Translates the two dashboard domain errors that still need it, and hands
 * everything else back untouched.
 *
 * Matched on the imported classes rather than on `error.name`: both halves now
 * come from this package, so identity is available and a renamed class cannot
 * silently stop being translated.
 */
function mapDashboardError(error: unknown): never {
  if (error instanceof DashboardNotFoundError || error instanceof DashboardReorderError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
}

async function dashboardCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    mapDashboardError(error);
  }
}

const projectScopeSchema = z.object({ projectId: z.string() });
const dashboardScopeSchema = projectScopeSchema.extend({ dashboardId: z.string() });

/**
 * Installs the complete `dashboards.*` tRPC surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 */
export class DashboardTrpcApi {
  static create<
    TContext extends DashboardTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: DashboardTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * The card count is the `builder` scope because the detail read below
       * returns builder graphs and nothing else: a list that counted the
       * workbench charts too would promise cards the grid never draws.
       *
       * `_count.graphs` is the shape the pages have always read, kept here
       * rather than pushed into the service, which speaks `graphCount`.
       */
      getAll: policy("analytics:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) => {
          const dashboards = await dashboardCall(() =>
            ctx.app.dashboard.getAll({
              projectId: input.projectId,
              graphCountScope: "builder",
            }),
          );
          return dashboards.map(({ graphCount, ...dashboard }) => ({
            ...dashboard,
            _count: { graphs: graphCount },
          }));
        },
      ),

      getById: policy("analytics:view")(procedure.input(dashboardScopeSchema)).query(
        async ({ ctx, input }) =>
          await dashboardCall(() =>
            ctx.app.dashboard.getById({
              projectId: input.projectId,
              dashboardId: input.dashboardId,
            }),
          ),
      ),

      create: policy("analytics:create")(
        procedure.input(projectScopeSchema.extend({ name: z.string() })),
      ).mutation(
        async ({ ctx, input }) =>
          await dashboardCall(() =>
            ctx.app.dashboard.create({ projectId: input.projectId, name: input.name }),
          ),
      ),

      rename: policy("analytics:update")(
        procedure.input(dashboardScopeSchema.extend({ name: z.string() })),
      ).mutation(
        async ({ ctx, input }) =>
          await dashboardCall(() =>
            ctx.app.dashboard.rename({
              projectId: input.projectId,
              dashboardId: input.dashboardId,
              name: input.name,
            }),
          ),
      ),

      /** Cascades to the dashboard's graphs. */
      delete: policy("analytics:delete")(procedure.input(dashboardScopeSchema)).mutation(
        async ({ ctx, input }) =>
          await dashboardCall(() =>
            ctx.app.dashboard.delete({
              projectId: input.projectId,
              dashboardId: input.dashboardId,
            }),
          ),
      ),

      reorderDashboards: policy("analytics:update")(
        procedure.input(projectScopeSchema.extend({ dashboardIds: z.array(z.string()) })),
      ).mutation(
        async ({ ctx, input }) =>
          await dashboardCall(() =>
            ctx.app.dashboard.reorder({
              projectId: input.projectId,
              dashboardIds: input.dashboardIds,
            }),
          ),
      ),

      /** Every project has at least one dashboard once this has been asked. */
      getOrCreateFirst: policy("analytics:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) =>
          await dashboardCall(() =>
            ctx.app.dashboard.getOrCreateFirst({ projectId: input.projectId }),
          ),
      ),
    });
  }
}
