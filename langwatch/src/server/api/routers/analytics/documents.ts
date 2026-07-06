import { sharedFiltersInputSchema } from "../../../analytics/types";
import { getAnalyticsService } from "../../../app-layer/analytics";
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
