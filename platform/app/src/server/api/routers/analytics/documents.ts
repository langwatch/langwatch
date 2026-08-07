import { sharedFiltersInputSchema } from "../../../analytics/types";
import { getApp } from "../../../app-layer/app";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";

export const topUsedDocuments = protectedProcedure
  .input(sharedFiltersInputSchema)
  .use(checkProjectPermission("cost:view"))
  .query(async ({ input }) => {
    const analyticsService = getApp().analytics.service;
    return analyticsService.getTopUsedDocuments({
      projectId: input.projectId,
      startDate: input.startDate,
      endDate: input.endDate,
      filters: input.filters,
    });
  });
