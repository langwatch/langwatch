import { checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import {
  currentVsPreviousTracesAggregation,
  groupedTracesAggregation,
  sharedAnalyticsFilterInput,
  sharedAnalyticsFilterInputWithAggregations,
} from "./common";

export const satisfactionVsPreviousPeriod = protectedProcedure
  .input(sharedAnalyticsFilterInput)
  .use(checkUserPermissionForProject)
  .query(async ({ input }) => {
    return await currentVsPreviousTracesAggregation<{
      positive: number;
      negative: number;
      neutral: number;
    }>({
      input,
      aggs: {
        positive: {
          range: {
            field: "input.satisfaction_score",
            ranges: [{ from: 0.1 }],
          },
        },
        negative: {
          range: {
            field: "input.satisfaction_score",
            ranges: [{ to: -0.1 }],
          },
        },
        neutral: {
          range: {
            field: "input.satisfaction_score",
            ranges: [{ from: -0.1, to: 0.1 }],
          },
        },
      },
    });
  });

export const satisfactionAggregated = protectedProcedure
  .input(sharedAnalyticsFilterInputWithAggregations)
  .use(checkUserPermissionForProject)
  .query(async ({ input }) => {
    return await groupedTracesAggregation<{
      positive: number;
      negative: number;
      neutral: number;
    }>({
      input,
      aggs: {
        positive: {
          range: {
            field: "input.satisfaction_score",
            ranges: [{ from: 0.1 }],
          },
        },
        negative: {
          range: {
            field: "input.satisfaction_score",
            ranges: [{ to: -0.1 }],
          },
        },
        neutral: {
          range: {
            field: "input.satisfaction_score",
            ranges: [{ from: -0.1, to: 0.1 }],
          },
        },
      },
    });
  });
