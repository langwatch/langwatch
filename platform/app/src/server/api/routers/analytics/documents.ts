import { sharedFiltersInputSchema } from "../../../analytics/types";
import { getApp } from "../../../app-layer/app";
import { protectedProcedure } from "../../trpc";

export const topUsedDocuments = protectedProcedure
  .input(sharedFiltersInputSchema)
  .permission("cost:view")
  .query(async ({ input }) => {
    const analyticsService = getApp().analytics.service;
    return analyticsService.getTopUsedDocuments(
      input.projectId,
      input.startDate,
      input.endDate,
      input.filters,
    );
  });
