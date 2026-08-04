import { timeseriesInput } from "../../../analytics/registry";
import { getAnalyticsService } from "../../../app-layer/analytics";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";

export const getTimeseries = protectedProcedure
  .input(timeseriesInput)
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ input }) => {
    const analyticsService = getAnalyticsService();
    return analyticsService.getTimeseries(input);
  });
