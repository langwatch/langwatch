import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRACE_CHECKS_INDEX, TRACE_INDEX, esClient } from "../../elasticsearch";
import { checkUserPermissionForProject } from "../permission";

export const analyticsRouter = createTRPCRouter({
  getTracesAnalyticsPerDay: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.number(),
        endDate: z.number(),
      })
    )
    .use(checkUserPermissionForProject)
    .query(async ({ input }) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);

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
                { term: { project_id: input.projectId } },
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
    }),
  getUsageMetrics: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.number(),
        endDate: z.number(),
      })
    )
    .use(checkUserPermissionForProject)
    .query(async ({ input }) => {
      const { projectId, startDate, endDate } = input;
      const result = await esClient.search({
        index: TRACE_INDEX,
        body: {
          size: 0,
          query: {
            //@ts-ignore
            bool: {
              filter: [
                { term: { project_id: projectId } },
                {
                  range: {
                    "timestamps.started_at": {
                      gte: startDate,
                      lte: endDate,
                    },
                  },
                },
              ],
            },
          },
        },
        aggs: {
          avg_tokens_per_trace: {
            avg: {
              script: {
                source:
                  "if (doc['metrics.prompt_tokens'].size() > 0 && doc['metrics.completion_tokens'].size() > 0) { return doc['metrics.prompt_tokens'].value + doc['metrics.completion_tokens'].value } else { return 0 }",
              },
            },
          },
          avg_total_cost_per_1000_traces: {
            avg: {
              field: "metrics.total_cost",
            },
          },
          percentile_time_to_first_token: {
            percentiles: {
              field: "metrics.first_token_ms",
              percents: [90],
            },
          },
          percentile_total_time_ms: {
            percentiles: {
              field: "metrics.total_time_ms",
              percents: [90],
            },
          },
        },
      });

      const aggregations: any = result.aggregations;

      return {
        avg_tokens_per_trace: aggregations?.avg_tokens_per_trace
          .value as number,
        avg_total_cost_per_1000_traces:
          (aggregations?.avg_total_cost_per_1000_traces.value as number),
        percentile_90th_time_to_first_token: aggregations
          ?.percentile_time_to_first_token.values["90.0"] as number,
        percentile_90th_total_time_ms: aggregations?.percentile_total_time_ms
          .values["90.0"] as number,
      };
    }),
  getTraceCheckStatusCounts: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.number(),
        endDate: z.number(),
      })
    )
    .use(checkUserPermissionForProject)
    .query(async ({ input }) => {
      const { projectId, startDate, endDate } = input;
      const result = await esClient.search({
        index: TRACE_CHECKS_INDEX,
        body: {
          size: 0,
          query: {
            //@ts-ignore
            bool: {
              filter: [
                { term: { project_id: projectId } },
                {
                  range: {
                    "timestamps.inserted_at": {
                      gte: startDate,
                      lte: endDate,
                    },
                  },
                },
              ],
            },
          },
          aggs: {
            status_counts: {
              terms: {
                field: "status",
              },
            },
          },
        },
      });

      const buckets: any[] | undefined = (
        result.aggregations?.status_counts as any
      )?.buckets;

      const statusCounts = buckets?.reduce((acc, bucket) => {
        acc[bucket.key] = bucket.doc_count;
        return acc;
      }, {});

      return {
        failed: (statusCounts?.failed as number) || 0,
        succeeded: (statusCounts?.succeeded as number) || 0,
      };
    }),
});
