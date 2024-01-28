import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import {
  currentVsPreviousEventsAggregation,
  sharedAnalyticsFilterInput,
} from "./common";

export const thumbsUpDownVsPreviousPeriod = protectedProcedure
  .input(sharedAnalyticsFilterInput)
  .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
  .query(async ({ input }) => {
    return await currentVsPreviousEventsAggregation<{
      metrics: {
        positive: { doc_count: number };
        negative: { doc_count: number };
      };
    }>({
      input,
      extraConditions: [
        {
          term: { event_type: "thumbs_up_down" },
        },
      ],
      aggs: {
        metrics: {
          nested: {
            path: "metrics",
          },
          aggs: {
            positive: {
              filter: {
                //@ts-ignore
                bool: {
                  must: [
                    { term: { "metrics.key": "vote" } },
                    { term: { "metrics.value": 1 } },
                  ],
                },
              },
            },
            negative: {
              filter: {
                //@ts-ignore
                bool: {
                  must: [
                    { term: { "metrics.key": "vote" } },
                    { term: { "metrics.value": -1 } },
                  ],
                },
              },
            },
          },
        },
      },
    });
  });
