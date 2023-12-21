import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRACE_CHECKS_INDEX, TRACE_INDEX, esClient } from "../../elasticsearch";
import { checkUserPermissionForProject } from "../permission";

const sharedAnalyticsFilterInput = z.object({
  projectId: z.string(),
  startDate: z.number(),
  endDate: z.number(),
  user_id: z.string().optional(),
  thread_id: z.string().optional(),
  customer_ids: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

const generateQueryConditions = ({
  projectId,
  startDate,
  endDate,
  user_id,
  thread_id,
  customer_ids,
  labels,
}: z.infer<typeof sharedAnalyticsFilterInput>) => {
  // If end date is very close to now, force it to be now, to allow frontend to keep refetching for new messages
  const endDate_ =
    new Date().getTime() - endDate < 1000 * 60 * 60
      ? new Date().getTime()
      : endDate;

  return [
    {
      term: { project_id: projectId },
    },
    {
      range: {
        "timestamps.inserted_at": {
          gte: startDate,
          lte: endDate_,
          format: "epoch_millis",
        },
      },
    },
    ...(user_id ? [{ term: { user_id: user_id } }] : []),
    ...(thread_id ? [{ term: { thread_id: thread_id } }] : []),
    ...(customer_ids ? [{ terms: { customer_id: customer_ids } }] : []),
    ...(labels ? [{ terms: { labels: labels } }] : []),
  ];
};

export const analyticsRouter = createTRPCRouter({
  getTracesAnalyticsPerDay: protectedProcedure
    .input(sharedAnalyticsFilterInput)
    .use(checkUserPermissionForProject)
    .query(async ({ input }) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);

      const aggregationFields = [];
      if (input.customer_ids && input.customer_ids.length > 1) {
        aggregationFields.push("customer_id");
      }
      if (input.labels && input.labels.length > 1) {
        aggregationFields.push("labels");
      }

      const aggregationQuery = {
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
            count: { value_count: { field: "id" } },
            total_cost: { sum: { field: "metrics.total_cost" } },
            prompt_tokens: { sum: { field: "metrics.prompt_tokens" } },
            completion_tokens: {
              sum: { field: "metrics.completion_tokens" },
            },
          },
        },
      };

      const aggs = aggregationFields.reduce(
        (acc, field) => {
          acc[field] = {
            terms: { field, size: 100 },
            aggs: aggregationQuery,
          };
          return acc;
        },
        {} as Record<string, any>
      );

      const result = await esClient.search({
        index: TRACE_INDEX,
        body: {
          aggs: {
            ...aggs,
            ...(aggregationFields.length === 0
              ? (aggregationQuery as any)
              : {}),
          },
          query: {
            bool: {
              //@ts-ignore
              filter: generateQueryConditions(input),
            },
          },
          size: 0,
        },
      });

      // Little hack to make non-aggregated results compatible with the rest
      const default_traces_per_day = result.aggregations?.traces_per_day;
      if (result.aggregations && default_traces_per_day) {
        result.aggregations.default = {
          buckets: [{ traces_per_day: default_traces_per_day }],
        };
        delete result.aggregations.traces_per_day;
      }

      const aggregations = Object.entries(result.aggregations ?? {}).reduce(
        (acc, [key, aggregation]) => {
          const buckets = (aggregation as any)?.buckets ?? [];
          for (const bucket of buckets) {
            acc[key == "default" ? "default" : bucket.key] =
              bucket?.traces_per_day?.buckets.map((bucket: any) => ({
                date: bucket.key_as_string,
                count: bucket.count.value,
                total_cost: bucket.total_cost.value,
                prompt_tokens: bucket.prompt_tokens.value,
                completion_tokens: bucket.completion_tokens.value,
              }));
          }

          return acc;
        },
        {} as Record<
          string,
          {
            date: string;
            count: number;
            total_cost: number;
            prompt_tokens: number;
            completion_tokens: number;
          }[]
        >
      );

      return aggregations;
    }),
  getUsageMetrics: protectedProcedure
    .input(sharedAnalyticsFilterInput)
    .use(checkUserPermissionForProject)
    .query(async ({ input }) => {
      const result = await esClient.search({
        index: TRACE_INDEX,
        body: {
          size: 0,
          query: {
            bool: {
              //@ts-ignore
              filter: generateQueryConditions(input),
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
        avg_total_cost_per_1000_traces: aggregations
          ?.avg_total_cost_per_1000_traces.value as number,
        percentile_90th_time_to_first_token: aggregations
          ?.percentile_time_to_first_token.values["90.0"] as number,
        percentile_90th_total_time_ms: aggregations?.percentile_total_time_ms
          .values["90.0"] as number,
      };
    }),
  getTraceCheckStatusCounts: protectedProcedure
    .input(sharedAnalyticsFilterInput)
    .use(checkUserPermissionForProject)
    .query(async ({ input }) => {
      const result = await esClient.search({
        index: TRACE_CHECKS_INDEX,
        body: {
          size: 0,
          query: {
            bool: {
              //@ts-ignore
              filter: generateQueryConditions(input),
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
