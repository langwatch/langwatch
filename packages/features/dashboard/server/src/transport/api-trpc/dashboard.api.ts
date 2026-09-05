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
 * Transport only: policy and delegation to `DashboardApp`. The refusals it
 * raises are named `HandledError`s, which the process's tRPC policy maps to a
 * code and a status, so nothing here translates an error any more.
 *
 * Spec: packages/features/dashboard/specs/dashboard-service.feature.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  dashboardReorderResponseSchema,
  dashboardTrpcDetailSchema,
  dashboardTrpcRowSchema,
  dashboardTrpcSummarySchema,
} from "@langwatch/dashboard-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { DashboardApp } from "#app/dashboard.app";

/**
 * The host supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the host's application this feature reaches, not the
 * feature's application itself, because a tRPC root is shared by every feature
 * mounted on it and so carries all of them. The REST families, built per
 * family, hold {@link DashboardApp} directly. Both reach the same object; only
 * the path to it differs.
 */
export type DashboardTrpcContext = Readonly<{ app: Readonly<{ dashboard: DashboardApp }> }>;

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
  /** Whether the chain checks every answer against its declared output schema. */
  validateOutput: boolean;
}>;

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
    return (
      createTrpcService({
        root: trpc,
        procedures,
        validateOutput: procedures.validateOutput,
      })
        /**
         * The card count is the `builder` scope because the detail read below
         * returns builder graphs and nothing else: a list that counted the
         * workbench charts too would promise cards the grid never draws.
         *
         * `_count.graphs` is the shape the pages have always read, kept here
         * rather than pushed into the service, which speaks `graphCount`.
         */
        .query("getAll", (p) =>
          p
            .withInput(projectScopeSchema)
            .withOutput(z.array(dashboardTrpcSummarySchema))
            .withPermission("analytics:view")
            .handle(async ({ ctx, input }) => {
              const dashboards = await ctx.app.dashboard.getAll({
                projectId: input.projectId,
                graphCountScope: "builder",
              });
              return dashboards.map(({ graphCount, ...dashboard }) => ({
                ...dashboard,
                _count: { graphs: graphCount },
              }));
            }),
        )
        .query("getById", (p) =>
          p
            .withInput(dashboardScopeSchema)
            .withOutput(dashboardTrpcDetailSchema)
            .withPermission("analytics:view")
            .handle(
              async ({ ctx, input }) =>
                await ctx.app.dashboard.getById({
                  projectId: input.projectId,
                  dashboardId: input.dashboardId,
                }),
            ),
        )
        .mutation("create", (p) =>
          p
            .withInput(projectScopeSchema.extend({ name: z.string() }))
            .withOutput(dashboardTrpcRowSchema)
            .withPermission("analytics:create")
            .handle(
              async ({ ctx, input }) =>
                await ctx.app.dashboard.create({ projectId: input.projectId, name: input.name }),
            ),
        )
        .mutation("rename", (p) =>
          p
            .withInput(dashboardScopeSchema.extend({ name: z.string() }))
            .withOutput(dashboardTrpcRowSchema)
            .withPermission("analytics:update")
            .handle(
              async ({ ctx, input }) =>
                await ctx.app.dashboard.rename({
                  projectId: input.projectId,
                  dashboardId: input.dashboardId,
                  name: input.name,
                }),
            ),
        )
        /** Cascades to the dashboard's graphs. */
        .mutation("delete", (p) =>
          p
            .withInput(dashboardScopeSchema)
            .withOutput(dashboardTrpcRowSchema)
            .withPermission("analytics:delete")
            .handle(
              async ({ ctx, input }) =>
                await ctx.app.dashboard.delete({
                  projectId: input.projectId,
                  dashboardId: input.dashboardId,
                }),
            ),
        )
        .mutation("reorderDashboards", (p) =>
          p
            .withInput(projectScopeSchema.extend({ dashboardIds: z.array(z.string()) }))
            .withOutput(dashboardReorderResponseSchema)
            .withPermission("analytics:update")
            .handle(
              async ({ ctx, input }) =>
                await ctx.app.dashboard.reorder({
                  projectId: input.projectId,
                  dashboardIds: input.dashboardIds,
                }),
            ),
        )
        /** Every project has at least one dashboard once this has been asked. */
        .query("getOrCreateFirst", (p) =>
          p
            .withInput(projectScopeSchema)
            .withOutput(dashboardTrpcRowSchema)
            .withPermission("analytics:view")
            .handle(
              async ({ ctx, input }) =>
                await ctx.app.dashboard.getOrCreateFirst({ projectId: input.projectId }),
            ),
        )
        .build()
    );
  }
}
