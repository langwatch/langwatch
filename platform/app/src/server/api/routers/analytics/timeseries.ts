import { timeseriesInput } from "../../../analytics/registry";
import { protectedProcedure } from "../../trpc";

export const getTimeseries = protectedProcedure
  .input(timeseriesInput)
  .permission("analytics:view")
  .query(async ({ input, ctx }) => {
    const analyticsService = ctx.app.analytics;
    return analyticsService.getTimeseries(input);
  });
