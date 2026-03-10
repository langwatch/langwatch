import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { SavedViewService } from "../../saved-views/saved-view.service";
import { savedViewErrorHandler } from "../../saved-views/middleware";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Saved Views Router - Manages saved view CRUD operations for traces page
 *
 * ARCHITECTURE:
 * - Router: Thin orchestration layer (input validation, permissions, error mapping)
 * - Service: Business logic (auto-seeding, order management, validation)
 * - Repository: Data access layer (Prisma queries with projectId multitenancy)
 */
export const savedViewsRouter = createTRPCRouter({
  /**
   * Gets all saved views for a project.
   * Auto-seeds with default origin views on first access.
   */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .use(savedViewErrorHandler)
    .query(async ({ ctx, input }) => {
      const service = SavedViewService.create(ctx.prisma);
      return await service.getAll({
        projectId: input.projectId,
        userId: ctx.session.user.id,
      });
    }),

  /**
   * Creates a new saved view.
   * When scope is "myself", the view is personal (only visible to the creator).
   * When scope is "project" (default), the view is shared with all team members.
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(255),
        filters: z.record(z.unknown()),
        query: z.string().optional(),
        period: z
          .object({
            relativeDays: z.number().optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
          })
          .optional(),
        scope: z.enum(["project", "myself"]).default("project"),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .use(savedViewErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const service = SavedViewService.create(ctx.prisma);
      return await service.createView({
        projectId: input.projectId,
        input: {
          name: input.name,
          filters: input.filters as Prisma.InputJsonValue,
          query: input.query,
          period: input.period as Prisma.InputJsonValue | undefined,
          userId: input.scope === "myself" ? ctx.session.user.id : undefined,
        },
      });
    }),

  /**
   * Deletes a saved view.
   */
  delete: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        viewId: z.string(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .use(savedViewErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const service = SavedViewService.create(ctx.prisma);
      return await service.delete({
        projectId: input.projectId,
        viewId: input.viewId,
        userId: ctx.session.user.id,
      });
    }),

  /**
   * Renames a saved view.
   */
  rename: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        viewId: z.string(),
        name: z.string().min(1).max(255),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .use(savedViewErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const service = SavedViewService.create(ctx.prisma);
      return await service.rename({
        projectId: input.projectId,
        viewId: input.viewId,
        name: input.name,
        userId: ctx.session.user.id,
      });
    }),

  /**
   * Reorders saved views by updating their order field.
   */
  reorder: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        viewIds: z.array(z.string()),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .use(savedViewErrorHandler)
    .mutation(async ({ ctx, input }) => {
      const service = SavedViewService.create(ctx.prisma);
      return await service.reorder({
        projectId: input.projectId,
        viewIds: input.viewIds,
      });
    }),
});
