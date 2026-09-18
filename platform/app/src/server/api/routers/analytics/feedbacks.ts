import { sharedFiltersInputSchema } from "../../../analytics/types";
import { getApp } from "../../../app-layer/app";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";

// Note: getFeedbacks only uses projectId, startDate, endDate, filters
// but we accept the full schema for API compatibility.
// Fields query, traceIds, negateFilters are accepted but ignored.
export const feedbacks = protectedProcedure
  .input(sharedFiltersInputSchema)
  .use(checkProjectPermission("cost:view"))
  .query(async ({ input }) => {
    const analyticsService = getApp().analytics.service;
    return analyticsService.getFeedbacks(
      input.projectId,
      input.startDate,
      input.endDate,
      input.filters,
    );
  });
