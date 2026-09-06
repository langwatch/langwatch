import { timeseriesInput } from "../../../analytics/registry";
import { getApp } from "../../../app-layer/app";
import { protectedProcedure } from "../../trpc";

export const getTimeseries = protectedProcedure
  .input(timeseriesInput)
  .permission("analytics:view")
  .query(async ({ input }) => {
    const analyticsService = getApp().analytics.service;
    return analyticsService.getTimeseries(input);
  });
