import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const dashboardsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("analytics:view"))
    .query(async ({ ctx, input }) => {
      const dashboards = await ctx.prisma.dashboard.findMany({
        where: { projectId: input.projectId },
        orderBy: { order: "asc" },
        include: {
          _count: {
            select: { graphs: true },
          },
        },
      });

      return dashboards;
    }),

  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), dashboardId: z.string() }))
    .use(checkProjectPermission("analytics:view"))
    .query(async ({ ctx, input }) => {
      const dashboard = await ctx.prisma.dashboard.findFirst({
        where: {
          id: input.dashboardId,
          projectId: input.projectId,
        },
        include: {
          graphs: {
            orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
          },
        },
      });

      if (!dashboard) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dashboard not found" });
      }

      return dashboard;
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
      }),
    )
    .use(checkProjectPermission("analytics:create"))
    .mutation(async ({ ctx, input }) => {
      // Get the highest order value
      const lastDashboard = await ctx.prisma.dashboard.findFirst({
        where: { projectId: input.projectId },
        orderBy: { order: "desc" },
      });

      const newOrder = (lastDashboard?.order ?? -1) + 1;

      return ctx.prisma.dashboard.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          name: input.name,
          order: newOrder,
        },
      });
    }),

  rename: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dashboardId: z.string(),
        name: z.string(),
      }),
    )
    .use(checkProjectPermission("analytics:update"))
    .mutation(async ({ ctx, input }) => {
      const dashboard = await ctx.prisma.dashboard.findFirst({
        where: {
          id: input.dashboardId,
          projectId: input.projectId,
        },
      });

      if (!dashboard) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dashboard not found" });
      }

      return ctx.prisma.dashboard.update({
        where: { id: input.dashboardId, projectId: input.projectId },
        data: { name: input.name },
      });
    }),

  delete: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dashboardId: z.string(),
      }),
    )
    .use(checkProjectPermission("analytics:delete"))
    .mutation(async ({ ctx, input }) => {
      const dashboard = await ctx.prisma.dashboard.findFirst({
        where: {
          id: input.dashboardId,
          projectId: input.projectId,
        },
      });

      if (!dashboard) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dashboard not found" });
      }

      // This will cascade delete all graphs on the dashboard due to onDelete: Cascade
      return ctx.prisma.dashboard.delete({
        where: { id: input.dashboardId, projectId: input.projectId },
      });
    }),

  reorderDashboards: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dashboardIds: z.array(z.string()),
      }),
    )
    .use(checkProjectPermission("analytics:update"))
    .mutation(async ({ ctx, input }) => {
      // Update order for each dashboard
      const updates = input.dashboardIds.map((dashboardId, index) =>
        ctx.prisma.dashboard.update({
          where: { id: dashboardId, projectId: input.projectId },
          data: { order: index },
        }),
      );

      await ctx.prisma.$transaction(updates);

      return { success: true };
    }),

  // Get or create the first dashboard for a project (used when none exist)
  getOrCreateFirst: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("analytics:view"))
    .query(async ({ ctx, input }) => {
      const existingDashboard = await ctx.prisma.dashboard.findFirst({
        where: { projectId: input.projectId },
        orderBy: { order: "asc" },
      });

      if (existingDashboard) {
        return existingDashboard;
      }

      // Create a default dashboard
      return ctx.prisma.dashboard.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          name: "Reports",
          order: 0,
        },
      });
    }),
});
