import { z } from "zod";
import { dashboardErrorHandler } from "../../dashboards/middleware";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Dashboard Router - Manages dashboard CRUD operations
 *
 * ARCHITECTURE:
 * - Router: Thin orchestration layer (input validation, permissions, error mapping)
 * - Service: Business logic (order management, validation)
 * - Repository: Data access layer (Prisma queries)
 */
export const dashboardsRouter = createTRPCRouter({
  /**
   * Gets all dashboards for a project.
   */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("analytics:view")
    .use(dashboardErrorHandler)
    .query(async ({ ctx, input }) => {
      const dashboards = await ctx.app.dashboard.getAll({
        projectId: input.projectId,
      });
      return dashboards.map(({ graphCount, ...dashboard }) => ({
        ...dashboard,
        _count: { graphs: graphCount },
      }));
    }),

  /**
   * Gets a dashboard by id, including its graphs.
   */
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), dashboardId: z.string() }))
    .permission("analytics:view")
    .use(dashboardErrorHandler)
    .query(async ({ ctx, input }) => {
      return await ctx.app.dashboard.getById(input);
    }),

  /**
   * Creates a new dashboard.
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
      }),
    )
    .permission("analytics:create")
    .use(dashboardErrorHandler)
    .mutation(async ({ ctx, input }) => {
      return await ctx.app.dashboard.create(input);
    }),

  /**
   * Renames a dashboard.
   */
  rename: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dashboardId: z.string(),
        name: z.string(),
      }),
    )
    .permission("analytics:update")
    .use(dashboardErrorHandler)
    .mutation(async ({ ctx, input }) => {
      return await ctx.app.dashboard.rename(input);
    }),

  /**
   * Deletes a dashboard (cascades to graphs).
   */
  delete: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dashboardId: z.string(),
      }),
    )
    .permission("analytics:delete")
    .use(dashboardErrorHandler)
    .mutation(async ({ ctx, input }) => {
      return await ctx.app.dashboard.delete(input);
    }),

  /**
   * Reorders dashboards by updating their order field.
   */
  reorderDashboards: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dashboardIds: z.array(z.string()),
      }),
    )
    .permission("analytics:update")
    .use(dashboardErrorHandler)
    .mutation(async ({ ctx, input }) => {
      return await ctx.app.dashboard.reorder(input);
    }),

  /**
   * Gets or creates the first dashboard for a project.
   * Used to ensure every project has at least one dashboard.
   */
  getOrCreateFirst: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("analytics:view")
    .use(dashboardErrorHandler)
    .query(async ({ ctx, input }) => {
      return await ctx.app.dashboard.getOrCreateFirst(input);
    }),
});
