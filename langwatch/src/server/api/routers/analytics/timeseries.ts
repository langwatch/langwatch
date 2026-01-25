import { timeseriesInput } from "../../../analytics/registry";
import { getAnalyticsService } from "../../../analytics/analytics.service";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";

export const getTimeseries = protectedProcedure
  .input(timeseriesInput)
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ input }) => {
    const analyticsService = getAnalyticsService();
    return analyticsService.getTimeseries(input);
  });
