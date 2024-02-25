import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import {
  currentVsPreviousTracesAggregation,
  sharedAnalyticsFilterInput,
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
