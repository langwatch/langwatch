import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRACE_INDEX, esClient } from "../../elasticsearch";

const getTracesAnalyticsPerDay = async (
  projectId: string,
  startDateTimestamp: number,
  endDateTimestamp: number
) => {
  const startDate = new Date(startDateTimestamp);
  const endDate = new Date(endDateTimestamp);

  const result = await esClient.search({
    index: TRACE_INDEX,
    body: {
      aggs: {
        traces_per_day: {
          date_histogram: {
            field: "timestamps.started_at",
            calendar_interval: "day",
            min_doc_count: 0,
            extended_bounds: {
              min: startDate.getTime(),
              max: endDate.getTime(),
            },
          },
          aggs: {
            count: {
              value_count: {
                field: "id",
              },
            },
            total_cost: {
              sum: {
                field: "metrics.total_cost",
              },
            },
            prompt_tokens: {
              sum: {
                field: "metrics.prompt_tokens",
              },
            },
            completion_tokens: {
              sum: {
                field: "metrics.completion_tokens",
              },
            },
          },
        },
      },
      query: {
        //@ts-ignore
        bool: {
          filter: [
            { term: { project_id: projectId } },
            {
              range: {
                "timestamps.started_at": {
                  gte: startDate.getTime(),
                  lte: endDate.getTime(),
                },
              },
            },
          ],
        },
      },
      size: 0,
    },
  });

  const buckets: any[] | undefined = (
    result.aggregations?.traces_per_day as any
  )?.buckets;

  return buckets?.map((bucket) => ({
    date: bucket.key_as_string,
    count: bucket.count.value,
    total_cost: bucket.total_cost.value,
    prompt_tokens: bucket.prompt_tokens.value,
    completion_tokens: bucket.completion_tokens.value,
  }));
};

export const analyticsRouter = createTRPCRouter({
  getTracesAnalyticsPerDay: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.number(),
        endDate: z.number(),
      })
    )
    .query(async ({ input }) => {
      return getTracesAnalyticsPerDay(
        input.projectId,
        input.startDate,
        input.endDate
      );
    }),
});
