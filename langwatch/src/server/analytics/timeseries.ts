import type {
  AggregationsAggregationContainer,
  MappingRuntimeField,
} from "@elastic/elasticsearch/lib/api/types";
import type { SearchRequest } from "@elastic/elasticsearch/lib/api/typesWithBodyKey";
import { TRPCError } from "@trpc/server";
import {
  getGroup,
  getMetric,
  type TimeseriesInputType,
} from "~/server/analytics/registry";
import {
  analyticsPipelines,
  pipelineAggregationsToElasticSearch,
  type FlattenAnalyticsGroupsEnum,
  type SeriesInputType,
} from "./registry";
import { prisma } from "../db";
import { TRACES_PIVOT_INDEX, esClient } from "../elasticsearch";
import {
  currentVsPreviousDates,
  generateTracesPivotQueryConditions,
} from "../api/routers/analytics/common";

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
  const { previousPeriodStartDate, startDate, endDate, daysDifference } =
    currentVsPreviousDates(
      input,
      typeof input.timeScale === "number" ? input.timeScale : undefined
    );

  let runtimeMappings: Record<string, MappingRuntimeField> = {};
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
          const pipelineBucketsPath = `${metric}.${aggregation}.${pipeline.field}`;
          const metricPath = metric_
            .extractionPath(aggregation, key, subkey)
            // Fix for working with percentiles too
            .split(">values")[0];
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
                gap_policy: "insert_zeros",
              },
            },
          };
        }

        if (metric_.runtimeMappings) {
          runtimeMappings = {
            ...runtimeMappings,
            ...metric_.runtimeMappings,
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

  const queryBody: SearchRequest["body"] = {
    size: 0,
    query: pivotIndexConditions,
    ...(Object.keys(runtimeMappings).length > 0
      ? { runtime_mappings: runtimeMappings }
      : {}),
    aggs:
      input.timeScale === "full"
        ? {
            previous_vs_current: {
              range: {
                field: "trace.timestamps.started_at",
                ranges: [
                  {
                    key: "previous",
                    from: previousPeriodStartDate.toISOString(),
                    to: startDate.toISOString(),
                  },
                  {
                    key: "current",
                    from: startDate.toISOString(),
                    to: endDate.toISOString(),
                  },
                ],
              },
              aggs,
            },
          }
        : ({
            traces_per_day: {
              date_histogram: {
                field: "trace.timestamps.started_at",
                fixed_interval: input.timeScale ? `${input.timeScale}d` : "1d",
                min_doc_count: 0,
                extended_bounds: {
                  min: previousPeriodStartDate.getTime(),
                  max: endDate.getTime(),
                },
              },
              aggs,
            },
          } as any),
  };

  const result = (await esClient.search({
    index: TRACES_PIVOT_INDEX,
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
      result.aggregations?.previous_vs_current.buckets;

    return {
      previousPeriod: parseAggregations([previous]),
      currentPeriod: parseAggregations([current]),
    };
  }

  const aggregations = parseAggregations(
    result.aggregations.traces_per_day.buckets
  );
  const toSlice = Math.ceil(daysDifference / (input.timeScale ?? 1));
  let previousPeriod = aggregations.slice(0, toSlice);
  const currentPeriod = aggregations.slice(toSlice);
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
  return {
    [`${metric}/${aggregation}`]:
      current && typeof current === "object" ? current.value : current,
  };
};

const pipelinePath = (
  metric: SeriesInputType["metric"],
  aggregation: SeriesInputType["aggregation"],
  pipeline: Required<SeriesInputType>["pipeline"]
) => `${metric}/${aggregation}/${pipeline.field}/${pipeline.aggregation}`;
