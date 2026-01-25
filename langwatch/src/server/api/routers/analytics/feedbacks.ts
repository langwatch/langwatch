import { getAnalyticsService } from "../../../analytics/analytics.service";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";

export const feedbacks = protectedProcedure
  .input(sharedFiltersInputSchema)
  .use(checkProjectPermission("cost:view"))
  .query(async ({ input }) => {
    const analyticsService = getAnalyticsService();
    return analyticsService.getFeedbacks(
      input.projectId,
      input.startDate,
      input.endDate,
      input.filters,
    );
  });
