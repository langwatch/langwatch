import type { AggregationsAggregationContainer } from "@elastic/elasticsearch/lib/api/types";
import type { SearchRequest } from "@elastic/elasticsearch/lib/api/typesWithBodyKey";
import { TRPCError } from "@trpc/server";
import {
  getGroup,
  getMetric,
  percentileToPercent,
  type TimeseriesInputType,
} from "~/server/analytics/registry";
import {
  analyticsPipelines,
  pipelineAggregationsToElasticSearch,
  type FlattenAnalyticsGroupsEnum,
  type SeriesInputType,
} from "./registry";
import { prisma } from "../db";
import { esClient, TRACE_INDEX } from "../elasticsearch";
import {
  currentVsPreviousDates,
  generateTracesPivotQueryConditions,
} from "../api/routers/analytics/common";
import {
  percentileAggregationTypes,
  type PercentileAggregationTypes,
} from "./types";
import { env } from "../../env.mjs";

const labelsMapping: Partial<
  Record<
    FlattenAnalyticsGroupsEnum,
    (projectId: string) => Promise<Record<string, string>>
  >
> = {
  "topics.topics": async (projectId: string) => {
    const topics = await prisma.topic.findMany({
      where: { projectId },
      select: { id: true, name: true },
    });

    return Object.fromEntries(topics.map((topic) => [topic.id, topic.name]));
  },

  "evaluations.evaluation_passed": async () => {
    return {
      0: "failed",
      1: "passed",
    };
  },
};

export const timeseries = async (input: TimeseriesInputType) => {
  if (env.IS_QUICKWIT) {
    // TODO: Remove this once Quickwit v0.9 is released as it supports cardinality
    input.series = input.series.map((series) => ({
      ...series,
      aggregation:
        series.aggregation === "cardinality" ? "terms" : series.aggregation,
    }));
  }

  const { previousPeriodStartDate, startDate, endDate, daysDifference } =
    currentVsPreviousDates(
      input,
      typeof input.timeScale === "number" ? input.timeScale : undefined
    );

  // Calculate total time span in minutes
  const totalMinutes =
    (endDate.getTime() - previousPeriodStartDate.getTime()) / (1000 * 60);

  // Adjust timeScale to avoid too many buckets (max 1000 buckets)
  let adjustedTimeScale = input.timeScale;
  if (typeof input.timeScale === "number") {
    const estimatedBuckets = totalMinutes / input.timeScale;
    if (estimatedBuckets > 1000) {
      // Round up to nearest minute that would give us less than 1000 buckets
      adjustedTimeScale = Math.ceil(totalMinutes / 1000);
    }
  }

  // Convert timeScale from minutes to days for the slicing calculation
  const timeScaleInDays =
    typeof adjustedTimeScale === "number"
      ? adjustedTimeScale / (24 * 60) // Convert minutes to days
      : 1;

  let aggs = Object.fromEntries(
    input.series.flatMap(
      ({ metric, aggregation, pipeline, key, subkey }: SeriesInputType) => {
        const metric_ = getMetric(metric);

        if (metric_.requiresKey && !metric_.requiresKey.optional && !key) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Metric ${metric} requires a key to be defined`,
          });
        }
        if (metric_.requiresSubkey && !subkey) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Metric ${metric} requires a subkey to be defined`,
          });
        }

        const metricAggregations = metric_.aggregation(
          aggregation,
          key,
          subkey
        );

        let aggregationQuery: Record<string, AggregationsAggregationContainer> =
          metricAggregations;
        if (pipeline) {
          // Fix needed for OpenSearch, it doesn't support dots in field names when referenced from buckets_path
          const metricWithoutDots = metric.replace(/\./g, "__");
          const pipelineBucketsPath = `${metricWithoutDots}__${aggregation}__${pipeline.field}`;
          const metricPath = metric_
            .extractionPath(aggregation, key, subkey)
            // Fix for working with percentiles too
            .split(">values")[0]
            ?.replace(/\./g, "__");
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
                buckets_path:
                  `${pipelineBucketsPath}>${metricPath}` +
                  (percentileAggregationTypes.includes(aggregation as any)
                    ? `.${
                        percentileToPercent[
                          aggregation as PercentileAggregationTypes
                        ]
                      }`
                    : ""),
                gap_policy: "insert_zeros",
              },
            },
          };
        }

        return Object.entries(aggregationQuery);
      }
    )
  );

  let groupLabelsMapping: Record<string, string> | undefined;
  if (input.groupBy) {
    const group = getGroup(input.groupBy);
    aggs = group.aggregation(aggs);
    if (labelsMapping[input.groupBy]) {
      groupLabelsMapping = await labelsMapping[input.groupBy]?.(
        input.projectId
      );
    }
  }

  const { pivotIndexConditions } = generateTracesPivotQueryConditions({
    ...input,
    startDate: previousPeriodStartDate.getTime(),
  });

  const tracesPerDayAggs = {
    date_histogram: {
      field: "timestamps.started_at",
      fixed_interval: adjustedTimeScale ? `${adjustedTimeScale}m` : "1d",
      min_doc_count: 0,
    },
    aggs,
  };

  const queryBody: SearchRequest["body"] = {
    size: 0,
    query: pivotIndexConditions,
    aggs: {
      previous_vs_current: {
        range: {
          field: "timestamps.started_at",
          ranges: [
            {
              key: "previous",
              from: env.IS_QUICKWIT
                ? previousPeriodStartDate.getTime() * 1000 * 1000
                : previousPeriodStartDate.toISOString(),
              to: env.IS_QUICKWIT
                ? startDate.getTime() * 1000 * 1000
                : startDate.toISOString(),
            },
            {
              key: "current",
              from: env.IS_QUICKWIT
                ? startDate.getTime() * 1000 * 1000
                : startDate.toISOString(),
              to: env.IS_QUICKWIT
                ? endDate.getTime() * 1000 * 1000
                : endDate.toISOString(),
            },
          ],
        },
        aggs:
          input.timeScale === "full"
            ? aggs
            : {
                traces_per_day: tracesPerDayAggs,
              },
      },
    } as any,
  };

  const client = await esClient({ projectId: input.projectId });
  const result = (await client.search({
    index: TRACE_INDEX.alias,
    body: queryBody,
  })) as any;

  const parseAggregations = (
    buckets: any
  ): ({ date: string } & Record<string, number>)[] => {
    return buckets.map((day_bucket: any) => {
      let aggregationResult: Record<string, any> = {
        date: day_bucket.key_as_string ?? day_bucket.from_as_string,
      };

      if (input.groupBy) {
        const group = getGroup(input.groupBy);
        const extractionPath = group.extractionPath();
        let buckets = day_bucket;
        const [pathsBeforeBuckets, pathsAfterBuckets] =
          extractionPath.split(">buckets");
        for (const path of pathsBeforeBuckets!.split(">")) {
          buckets = buckets[path];
        }
        buckets = buckets.buckets;

        if (!buckets) {
          throw `Could not find buckets for ${input.groupBy} groupBy at ${extractionPath}`;
        }

        const groupResult = Object.fromEntries(
          (Array.isArray(buckets)
            ? buckets.map((group_bucket: any) => {
                return [
                  groupLabelsMapping
                    ? groupLabelsMapping[group_bucket.key]
                    : group_bucket.key,
                  extractResultForBucket(
                    input.series,
                    pathsAfterBuckets,
                    group_bucket
                  ),
                ];
              })
            : Object.entries(buckets).map(
                ([key, group_bucket]: [string, any]) => {
                  return [
                    groupLabelsMapping ? groupLabelsMapping[key] : key,
                    extractResultForBucket(
                      input.series,
                      pathsAfterBuckets,
                      group_bucket
                    ),
                  ];
                }
              )
          ).filter(([key, _]) => key !== undefined)
        );

        aggregationResult = {
          ...aggregationResult,
          [input.groupBy]: groupResult,
        };
      } else {
        aggregationResult = {
          ...aggregationResult,
          ...extractResultForBucket(input.series, undefined, day_bucket),
        };
      }

      return aggregationResult;
    });
  };

  if (input.timeScale === "full") {
    const [previous, current] =
      result.aggregations?.previous_vs_current.buckets.filter(
        (bucket: any) => bucket.key === "previous" || bucket.key === "current"
      );

    return {
      previousPeriod: parseAggregations([previous]),
      currentPeriod: parseAggregations([current]),
    };
  }

  const currentPeriod = parseAggregations(
    result.aggregations.previous_vs_current.buckets.find(
      (bucket: any) => bucket.key === "current"
    ).traces_per_day.buckets
  );

  let previousPeriod = parseAggregations(
    result.aggregations.previous_vs_current.buckets.find(
      (bucket: any) => bucket.key === "previous"
    ).traces_per_day.buckets
  );
  // Correction for when a single day is selected and we end up querying for 2 days for previous period and dates don't align
  previousPeriod = previousPeriod.slice(
    Math.max(0, previousPeriod.length - currentPeriod.length)
  );

  return {
    previousPeriod: previousPeriod,
    currentPeriod: currentPeriod,
  };
};

const extractResultForBucket = (
  seriesList: SeriesInputType[],
  pathsAfterBuckets: string | undefined,
  bucket: any
) => {
  return Object.fromEntries(
    seriesList.flatMap((series) => {
      return Object.entries(extractResult(series, pathsAfterBuckets, bucket));
    })
  );
};

const extractResult = (
  { metric, aggregation, pipeline, key, subkey }: SeriesInputType,
  pathsAfterBuckets: string | undefined,
  result: any
) => {
  let current = result;
  if (pathsAfterBuckets) {
    for (const path of pathsAfterBuckets.split(">")) {
      if (path) {
        current = current[path];
      }
    }
  }

  const metric_ = getMetric(metric);
  const paths = metric_.extractionPath(aggregation, key, subkey).split(">");
  if (pipeline) {
    const pipelinePath_ = pipelinePath(metric, aggregation, pipeline);
    return { [pipelinePath_]: current[pipelinePath_].value };
  }

  for (const path of paths) {
    current = current[path];
  }

  let value = current && typeof current === "object" ? current.value : current;
  if (aggregation === "terms" && typeof current === "object") {
    if (metric === "metadata.trace_id") {
      value = current.sum_other_doc_count;
    } else {
      value = current.buckets.length;
    }
  }
  return {
    [`${metric}/${aggregation.replace("terms", "cardinality")}`]: value,
  };
};

const pipelinePath = (
  metric: SeriesInputType["metric"],
  aggregation: SeriesInputType["aggregation"],
  pipeline: Required<SeriesInputType>["pipeline"]
) => `${metric}/${aggregation}/${pipeline.field}/${pipeline.aggregation}`;
