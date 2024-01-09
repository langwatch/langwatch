import { checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import {
  currentVsPreviousTracesAggregation,
  groupedTracesAggregation,
  sharedAnalyticsFilterInput,
  sharedAnalyticsFilterInputWithAggregations,
} from "./common";

export const llmCostSumVsPreviousPeriod = protectedProcedure
  .input(sharedAnalyticsFilterInput)
  .use(checkUserPermissionForProject)
  .query(async ({ input }) => {
    return await currentVsPreviousTracesAggregation<{ total_cost: number }>({
      input,
      aggs: {
        total_cost: { sum: { field: "metrics.total_cost" } },
      },
    });
  });

export const llmCostSumAggregated = protectedProcedure
  .input(sharedAnalyticsFilterInputWithAggregations)
  .use(checkUserPermissionForProject)
  .query(async ({ input }) => {
    return await groupedTracesAggregation<{ total_cost: number }>({
      input,
      aggs: {
        total_cost: { sum: { field: "metrics.total_cost" } },
      },
    });
  });
