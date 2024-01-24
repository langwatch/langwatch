import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import {
  currentVsPreviousTracesAggregation,
  groupedTracesAggregation,
  sharedAnalyticsFilterInput,
  sharedAnalyticsFilterInputWithAggregations,
} from "./common";

export const tokensSumVsPreviousPeriod = protectedProcedure
  .input(sharedAnalyticsFilterInput)
  .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
  .query(async ({ input }) => {
    return await currentVsPreviousTracesAggregation<{
      prompt_tokens: number;
      completion_tokens: number;
    }>({
      input,
      aggs: {
        prompt_tokens: { sum: { field: "metrics.prompt_tokens" } },
        completion_tokens: {
          sum: { field: "metrics.completion_tokens" },
        },
      },
    });
  });

export const tokensSumAggregated = protectedProcedure
  .input(sharedAnalyticsFilterInputWithAggregations)
  .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
  .query(async ({ input }) => {
    return await groupedTracesAggregation<{
      prompt_tokens: number;
      completion_tokens: number;
    }>({
      input,
      aggs: {
        prompt_tokens: { sum: { field: "metrics.prompt_tokens" } },
        completion_tokens: {
          sum: { field: "metrics.completion_tokens" },
        },
      },
    });
  });
