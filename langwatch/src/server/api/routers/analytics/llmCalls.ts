import { checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import {
  currentVsPreviousSpansAggregation,
  groupedSpansAggregation,
  sharedAnalyticsFilterInput,
  sharedAnalyticsFilterInputWithAggregations,
} from "./common";

export const llmCallsCountVsPreviousPeriod = protectedProcedure
  .input(sharedAnalyticsFilterInput)
  .use(checkUserPermissionForProject)
  .query(async ({ input }) => {
    return await currentVsPreviousSpansAggregation<{ count: number }>({
      input,
      aggs: {
        count: { value_count: { field: "id" } },
      },
      extraConditions: [{ term: { type: "llm" } }],
    });
  });

export const llmCallsCountAggregated = protectedProcedure
  .input(sharedAnalyticsFilterInputWithAggregations)
  .use(checkUserPermissionForProject)
  .query(async ({ input }) => {
    return await groupedSpansAggregation<{ count: number }>({
      input,
      aggs: {
        count: { value_count: { field: "id" } },
      },
      extraConditions: [{ term: { type: "llm" } }],
    });
  });
