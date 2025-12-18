import { z } from "zod";
import { DashboardService } from "../../dashboards/dashboard.service";
import { dashboardErrorHandler } from "../../dashboards/middleware";
import { checkProjectPermission } from "../rbac";
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
    .use(checkProjectPermission("analytics:view"))
    .use(dashboardErrorHandler)
    .query(async ({ ctx, input }) => {
      const service = DashboardService.create(ctx.prisma);
      return await service.getAll(input.projectId);
    }),

  /**
   * Gets a dashboard by id, including its graphs.
   */
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), dashboardId: z.string() }))
    .use(checkProjectPermission("analytics:view"))
    .use(dashboardErrorHandler)
    .query(async ({ ctx, input }) => {
      const service = DashboardService.create(ctx.prisma);
      return await service.getById(input.projectId, input.dashboardId);
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
    .use(checkProjectPermission("analytics:create"))
    .use(dashboardErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const service = DashboardService.create(ctx.prisma);
      return await service.create(input.projectId, input.name);
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
    .use(checkProjectPermission("analytics:update"))
    .use(dashboardErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const service = DashboardService.create(ctx.prisma);
      return await service.rename(input.projectId, input.dashboardId, input.name);
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
    .use(checkProjectPermission("analytics:delete"))
    .use(dashboardErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const service = DashboardService.create(ctx.prisma);
      return await service.delete(input.projectId, input.dashboardId);
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
    .use(checkProjectPermission("analytics:update"))
    .use(dashboardErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const service = DashboardService.create(ctx.prisma);
      return await service.reorder(input.projectId, input.dashboardIds);
    }),

  /**
   * Gets or creates the first dashboard for a project.
   * Used to ensure every project has at least one dashboard.
   */
  getOrCreateFirst: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("analytics:view"))
    .use(dashboardErrorHandler)
    .query(async ({ ctx, input }) => {
      const service = DashboardService.create(ctx.prisma);
      return await service.getOrCreateFirst(input.projectId);
    }),
});
