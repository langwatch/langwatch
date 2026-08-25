import { sharedFiltersInputSchema } from "../../../analytics/types";
import { protectedProcedure } from "../../trpc";

// Note: getFeedbacks only uses projectId, startDate, endDate, filters
// but we accept the full schema for API compatibility.
// Fields query, traceIds, negateFilters are accepted but ignored.
export const feedbacks = protectedProcedure
  .input(sharedFiltersInputSchema)
  .permission("cost:view")
  .query(async ({ input, ctx }) => {
    const analyticsService = ctx.app.analytics;
    return analyticsService.getFeedbacks(input);
  });
