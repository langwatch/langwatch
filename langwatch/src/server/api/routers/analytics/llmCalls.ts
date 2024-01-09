import { checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import {
  groupedSpansAggregation,
  sharedAnalyticsFilterInputWithAggregations,
} from "./common";

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
