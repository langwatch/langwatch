import type {
  AggregationsAggregationContainer,
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import { type z } from "zod";
import { getGroup, getMetric } from "~/server/analytics/registry";
import {
  pipelineAggregationsToElasticSearch,
  analyticsPipelines,
  type FlattenAnalyticsGroupsEnum,
  timeseriesInput,
  type SeriesInputType,
} from "../../../analytics/registry";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import { TRACES_PIVOT_INDEX, esClient } from "../../../elasticsearch";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import { currentVsPreviousDates, dateTicks } from "./common";

export const generateTracesPivotQueryConditions = ({
  projectId,
  startDate,
  endDate,
  filters,
}: z.infer<typeof sharedFiltersInputSchema>): QueryDslQueryContainer[] => {
  // If end date is very close to now, force it to be now, to allow frontend to keep refetching for new messages
  const endDate_ =
    new Date().getTime() - endDate < 1000 * 60 * 60
      ? new Date().getTime()
      : endDate;

  const { metadata, topics: topicsGroup } = filters;
  const { topics } = topicsGroup ?? {};
  const { user_id, thread_id, customer_id, labels } = metadata ?? {};

  return [
    {
      term: { "trace.project_id": projectId },
    },
    {
      range: {
        "trace.timestamps.started_at": {
          gte: startDate,
          lte: endDate_,
          format: "epoch_millis",
        },
      },
    },
    ...(user_id ? [{ term: { "trace.metadata.user_id": user_id } }] : []),
    ...(thread_id ? [{ term: { "trace.metadata.thread_id": thread_id } }] : []),
    ...(customer_id
      ? [{ terms: { "trace.metadata.customer_id": customer_id } }]
      : []),
    ...(labels ? [{ terms: { "trace.metadata.labels": labels } }] : []),
    ...(topics ? [{ terms: { "trace.metadata.topics": topics } }] : []),
  ];
};

export const getTimeseries = protectedProcedure
  .input(sharedFiltersInputSchema.extend(timeseriesInput.shape))
  .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
  .query(async ({ input }) => {
    const { previousPeriodStartDate, endDate, daysDifference } =
      currentVsPreviousDates(input);

    const date_histogram = dateTicks(
      previousPeriodStartDate,
      endDate,
      "trace.timestamps.started_at"
    ) as any;

    let aggs = Object.fromEntries(
      input.series.flatMap(({ metric, aggregation, pipeline }) => {
        const metric_ = getMetric(metric);

        const metricAggregations = metric_.aggregation(aggregation);

        let aggregationQuery: Record<string, AggregationsAggregationContainer> =
          metricAggregations;
        if (pipeline) {
          const pipelineBucketsPath = `${metric}.${aggregation}.${pipeline.field}`;
          const metricPath = metric_.extractionPath(aggregation);
          const pipelinePath_ = pipelinePath(metric, aggregation, pipeline);

          aggregationQuery = {
            [pipelineBucketsPath]: {
              terms: {
                field: analyticsPipelines[pipeline.field].field,
                size: 10000,
              },
              aggs: aggregationQuery,
            },
            [pipelinePath_]: {
              [pipelineAggregationsToElasticSearch[pipeline.aggregation]]: {
                buckets_path: `${pipelineBucketsPath}>${metricPath}`,
              },
            },
          };
        }

        return Object.entries(aggregationQuery);
      })
    );

    if (input.groupBy) {
      const group = getGroup(input.groupBy);
      aggs = {
        [input.groupBy]: {
          ...group.aggregation(),
          aggs,
        },
      };
    }

    const result = await esClient.search({
      index: TRACES_PIVOT_INDEX,
      body: {
        size: 0,
        query: {
          bool: {
            filter: generateTracesPivotQueryConditions(input),
          } as QueryDslBoolQuery,
        },
        aggs: {
          traces_per_day: {
            date_histogram,
            aggs,
          },
        },
      },
    });

    const aggregations: ({ date: string } & (
      | Record<string, number>
      | Record<
          FlattenAnalyticsGroupsEnum,
          Record<string, Record<string, number>>
        >
    ))[] = (result.aggregations?.traces_per_day as any)?.buckets.map(
      (day_bucket: any) => {
        let aggregationResult: Record<string, any> = {
          date: day_bucket.key_as_string,
        };

        if (input.groupBy) {
          const groupResult = Object.fromEntries(
            day_bucket[input.groupBy].buckets.map((group_bucket: any) => {
              return [
                group_bucket.key,
                extractResultForBucket(input.series, group_bucket),
              ];
            })
          );
          aggregationResult = {
            ...aggregationResult,
            [input.groupBy]: groupResult,
          };
        } else {
          aggregationResult = {
            ...aggregationResult,
            ...extractResultForBucket(input.series, day_bucket),
          };
        }

        return aggregationResult;
      }
    );

    const previousPeriod = aggregations.slice(0, daysDifference);
    const currentPeriod = aggregations.slice(daysDifference);

    return {
      previousPeriod,
      currentPeriod,
    };
  });

const extractResultForBucket = (seriesList: SeriesInputType[], bucket: any) => {
  return Object.fromEntries(
    seriesList.flatMap((series) => {
      return Object.entries(extractResult(series, bucket));
    })
  );
};

const extractResult = (
  { metric, aggregation, pipeline }: SeriesInputType,
  result: any
) => {
  const metric_ = getMetric(metric);
  const paths = metric_.extractionPath(aggregation).split(">");
  if (pipeline) {
    const pipelinePath_ = pipelinePath(metric, aggregation, pipeline);
    return { [pipelinePath_]: result[pipelinePath_].value };
  }

  let current = result;
  for (const path of paths) {
    current = current[path];
  }
  return { [`${metric}/${aggregation}`]: current.value };
};

const pipelinePath = (
  metric: SeriesInputType["metric"],
  aggregation: SeriesInputType["aggregation"],
  pipeline: Required<SeriesInputType>["pipeline"]
) => `${metric}/${aggregation}/${pipeline.field}/${pipeline.aggregation}`;
