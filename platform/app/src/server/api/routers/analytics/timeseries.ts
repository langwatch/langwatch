import { timeseriesInput } from "../../../analytics/registry";
import { getApp } from "../../../app-layer/app";
import { checkProjectPermission } from "../../rbac";
import { protectedProcedure } from "../../trpc";

export const getTimeseries = protectedProcedure
  .input(timeseriesInput)
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ input }) => {
    const analyticsService = getApp().analytics.service;
    return analyticsService.getTimeseries(input);
  });
