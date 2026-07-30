import { z } from "zod";
import { RecentItemsService } from "~/server/home/recent-items.service";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Home router
 * Provides endpoints for the project home page.
 * Note: Onboarding status is available via integrationsChecks.getCheckStatus
 */
export const homeRouter = createTRPCRouter({
  /**
   * Get recent items the user has interacted with
   * Queries AuditLog and hydrates with entity details
   */
  getRecentItems: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        limit: z.number().min(1).max(50).default(12),
      }),
    )
    .use(checkProjectPermission("project:view"))
    .query(async ({ ctx, input }) => {
      const recentItemsService = new RecentItemsService();
      return recentItemsService.getRecentItems({
        userId: ctx.session.user.id,
        projectId: input.projectId,
        limit: input.limit,
      });
    }),
});
