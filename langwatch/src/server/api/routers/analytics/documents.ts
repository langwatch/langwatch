import { getAnalyticsService } from "../../../analytics/analytics.service";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";

export const topUsedDocuments = protectedProcedure
  .input(sharedFiltersInputSchema)
  .use(checkProjectPermission("cost:view"))
  .query(async ({ input }) => {
    const analyticsService = getAnalyticsService();
    return analyticsService.getTopUsedDocuments(
      input.projectId,
      input.startDate,
      input.endDate,
      input.filters,
    );
  });
