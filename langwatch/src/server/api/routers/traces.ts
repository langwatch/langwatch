import { z } from "zod";

import { TRPCError } from "@trpc/server";
import similarity from "compute-cosine-similarity";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  sharedFiltersInputSchema,
  type TracesPivot,
} from "../../analytics/types";
import {
  SPAN_INDEX,
  TRACES_PIVOT_INDEX,
  TRACE_CHECKS_INDEX,
  TRACE_INDEX,
  esClient,
  traceIndexId,
} from "../../elasticsearch";
import { getOpenAIEmbeddings } from "../../embeddings";
import type { ElasticSearchSpan, Trace, TraceCheck } from "../../tracer/types";
import {
  TeamRoleGroup,
  backendHasTeamProjectPermission,
  checkUserPermissionForProject,
} from "../permission";
import { generateTracesPivotQueryConditions } from "./analytics/common";
import type {
  QueryDslBoolQuery,
  SearchTotalHits,
  Sort,
} from "@elastic/elasticsearch/lib/api/types";

const tracesFilterInput = sharedFiltersInputSchema.extend({
  pageOffset: z.number().optional(),
  pageSize: z.number().optional(),
});

export const esGetSpansByTraceId = async ({
  traceId,
  projectId,
}: {
  traceId: string;
  projectId: string;
}): Promise<ElasticSearchSpan[]> => {
  const result = await esClient.search<ElasticSearchSpan>({
    index: SPAN_INDEX,
    body: {
      query: {
        bool: {
          must: [
            { term: { trace_id: traceId } },
            { term: { project_id: projectId } },
          ] as QueryDslBoolQuery["must"],
        } as QueryDslBoolQuery,
      },
    },
    size: 10000,
    routing: traceIndexId({
      traceId,
      projectId,
    }),
  });

  return result.hits.hits.map((hit) => hit._source!).filter((hit) => hit);
};

export const tracesRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(
      tracesFilterInput.extend({
        query: z.string().optional(),
        groupBy: z.string().optional(),
        sortBy: z.string().optional(),
        sortDirection: z.string().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ ctx, input }) => {
      const embeddings = input.query
        ? await getOpenAIEmbeddings(input.query)
        : undefined;

      if (input.query && !embeddings) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get embeddings for query.",
        });
      }

      const { pivotIndexConditions, isAnyFilterPresent, endDateUsedForQuery } =
        generateTracesPivotQueryConditions(input);

      let traceIds: string[] = [];

      const pageSize = input.pageSize ? input.pageSize : 25;
      const pageOffset = input.pageOffset ? input.pageOffset : 0;

      let totalHits = 0;
      let usePivotIndex = false;
      if (isAnyFilterPresent || input.sortBy) {
        usePivotIndex = true;
        const pivotIndexResults = await esClient.search<TracesPivot>({
          index: TRACES_PIVOT_INDEX,
          body: {
            query: pivotIndexConditions,
            _source: ["trace.trace_id"],
            from: input.query ? 0 : pageOffset,
            size: input.query ? 10_000 : pageSize,
            ...(input.sortBy
              ? input.sortBy.startsWith("random.")
                ? {
                    sort: {
                      _script: {
                        type: "number",
                        script: {
                          source: "Math.random()",
                        },
                        order: input.sortDirection ?? "desc",
                      },
                    } as Sort,
                  }
                : input.sortBy.startsWith("trace_checks.")
                ? {
                    sort: {
                      "trace_checks.score": {
                        order: input.sortDirection ?? "desc",
                        nested: {
                          path: "trace_checks",
                          filter: {
                            term: {
                              "trace_checks.check_id":
                                input.sortBy.split(".")[1],
                            },
                          },
                        },
                      },
                    } as Sort,
                  }
                : {
                    sort: {
                      [input.sortBy]: {
                        order: input.sortDirection ?? "desc",
                      },
                    } as Sort,
                  }
              : {
                  sort: {
                    "trace.timestamps.started_at": {
                      order: "desc",
                    },
                  } as Sort,
                }),
          },
        });

        traceIds = pivotIndexResults.hits.hits
          .map((hit) => hit._source?.trace?.trace_id)
          .filter((x) => x)
          .map((x) => x!);

        totalHits =
          (pivotIndexResults.hits?.total as SearchTotalHits)?.value || 0;

        if (!traceIds.length) {
          return { groups: [], totalHits: 0 };
        }
      }

      const tracesIndexConditions = [
        {
          term: { project_id: input.projectId },
        },
        {
          range: {
            "timestamps.started_at": {
              gte: input.startDate,
              lte: endDateUsedForQuery,
              format: "epoch_millis",
            },
          },
        },
        ...(usePivotIndex ? [{ terms: { trace_id: traceIds } }] : []),
      ];

      const canSeeCosts = await backendHasTeamProjectPermission(
        ctx,
        input,
        TeamRoleGroup.COST_VIEW
      );

      //@ts-ignore
      const tracesResult = await esClient.search<Trace>({
        index: TRACE_INDEX,
        from: !usePivotIndex || input.query ? pageOffset : 0,
        size: !usePivotIndex || input.query ? pageSize : traceIds.length,
        _source: {
          excludes: [
            // TODO: do we really need to exclude both keys and nested keys for embeddings?
            ...(input.groupBy !== "input"
              ? ["input.embeddings", "input.embeddings.embeddings"]
              : []),
            ...(input.groupBy !== "output"
              ? ["output.embeddings", "input.embeddings.embeddings"]
              : []),
            ...(canSeeCosts ? [] : ["metrics.total_cost"]),
          ],
        },
        ...(!input.query
          ? {
              sort: {
                "timestamps.started_at": {
                  order: "desc",
                },
              },
            }
          : {}),
        body: {
          query: {
            bool: {
              must: [
                ...tracesIndexConditions,
                ...(input.query
                  ? [
                      {
                        bool: {
                          should: [
                            {
                              match: {
                                "input.value": input.query,
                              },
                            },
                            {
                              match: {
                                "output.value": input.query,
                              },
                            },
                          ],
                          boost: 100.0,
                          minimum_should_match: 1,
                        },
                      },
                    ]
                  : []),
              ],
            },
          },
          ...(input.query
            ? {
                knn: {
                  field: "input.embeddings.embeddings",
                  query_vector: embeddings?.embeddings,
                  k: 10,
                  num_candidates: 100,
                },
                rank: {
                  rrf: { window_size: 100 },
                },
              }
            : {}),
          // Ensures proper filters are applied even with knn
          post_filter: {
            bool: {
              must: tracesIndexConditions,
            },
          },
        },
      });

      const tracesById = Object.fromEntries(
        tracesResult.hits.hits
          .map((hit) => hit._source!)
          .filter((x) => x)
          .map((trace) => [trace.trace_id, trace])
      );

      const traces = usePivotIndex
        ? traceIds.map((id) => tracesById[id]!).filter((x) => x)
        : Object.values(tracesById);

      const groups = groupTraces(input.groupBy, traces);

      // Remove embeddings to reduce payload size
      for (const group of groups) {
        for (const trace of group) {
          delete trace.input?.embeddings;
          delete trace.output?.embeddings;
        }
      }

      if (!usePivotIndex) {
        totalHits = (tracesResult.hits?.total as SearchTotalHits)?.value || 0;
      }
      return { groups, totalHits };
    }),
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ ctx, input }) => {
      const canSeeCosts = await backendHasTeamProjectPermission(
        ctx,
        input,
        TeamRoleGroup.COST_VIEW
      );

      //@ts-ignore
      const result = await esClient.search<Trace>({
        index: TRACE_INDEX,
        size: 1,
        _source: {
          // TODO: do we really need to exclude both keys and nested keys for embeddings?
          excludes: [
            "input.embeddings",
            "input.embeddings.embeddings",
            "output.embeddings",
            "output.embeddings.embeddings",
            ...(canSeeCosts ? [] : ["metrics.total_cost"]),
          ],
        },
        body: {
          query: {
            //@ts-ignore
            bool: {
              filter: [
                { term: { trace_id: input.traceId } },
                { term: { project_id: input.projectId } },
              ],
            },
          },
        },
      });

      const trace = result.hits.hits[0]?._source;

      if (!trace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trace not found." });
      }

      return trace;
    }),
  getTraceChecks: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceIds: z.array(z.string()),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input }) => {
      const { projectId, traceIds } = input;

      const checksResult = await esClient.search<TraceCheck>({
        index: TRACE_CHECKS_INDEX,
        body: {
          size: Math.min(traceIds.length * 100, 10_000), // Assuming a maximum of 100 checks per trace
          query: {
            //@ts-ignore
            bool: {
              filter: [
                { terms: { trace_id: traceIds } },
                { term: { project_id: projectId } },
              ],
            },
          },
        },
      });

      const traceChecks = checksResult.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x);

      const checksPerTrace = traceChecks.reduce(
        (acc, check) => {
          if (check) {
            if (!acc[check.trace_id]) {
              acc[check.trace_id] = [];
            }
            acc[check.trace_id]!.push(check);
          }
          return acc;
        },
        {} as Record<string, TraceCheck[]>
      );

      return checksPerTrace;
    }),
  getTopicCounts: protectedProcedure
    .input(tracesFilterInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input, ctx }) => {
      const { pivotIndexConditions } =
        generateTracesPivotQueryConditions(input);

      const topicCountsResult = await esClient.search<TracesPivot>({
        index: TRACES_PIVOT_INDEX,
        size: 0, // We do not need the actual documents, just the aggregations
        body: {
          query: {
            bool: {
              must: pivotIndexConditions,
            } as QueryDslBoolQuery,
          },
          aggs: {
            topicCounts: {
              terms: {
                field: "trace.metadata.topic_id",
                size: 10000,
              },
            },
            subtopicCounts: {
              terms: {
                field: "trace.metadata.subtopic_id",
                size: 10000,
              },
            },
          },
        },
      });

      const topicsMap = Object.fromEntries(
        (
          await ctx.prisma.topic.findMany({
            where: {
              projectId: input.projectId,
            },
            select: { id: true, name: true, parentId: true },
          })
        ).map((topic) => [topic.id, topic])
      );

      const mapBuckets = (
        buckets: { key: string; doc_count: number }[],
        includeParent = false
      ) => {
        return buckets.reduce(
          (acc, bucket) => {
            const topic = topicsMap[bucket.key];

            if (!topic) return acc;

            return [
              ...acc,
              {
                id: bucket.key,
                name: topic.name,
                count: bucket.doc_count,
                ...(includeParent && { parentId: topic.parentId }),
              },
            ];
          },
          [] as { id: string; name: string; count: number }[]
        );
      };

      const topicBuckets: { key: string; doc_count: number }[] =
        (topicCountsResult.aggregations?.topicCounts as any)?.buckets ?? [];
      const topicCounts = mapBuckets(topicBuckets);

      const subtopicBuckets: { key: string; doc_count: number }[] =
        (topicCountsResult.aggregations?.subtopicCounts as any)?.buckets ?? [];
      const subtopicCounts = mapBuckets(subtopicBuckets, true) as {
        id: string;
        name: string;
        count: number;
        parentId: string;
      }[];

      return { topicCounts, subtopicCounts };
    }),
  getCustomersAndLabels: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input }) => {
      const customersLabelsResult = await esClient.search<Trace>({
        index: TRACE_INDEX,
        size: 0, // We don't need the actual documents, just the aggregation results
        body: {
          query: {
            term: {
              project_id: input.projectId,
            },
          },
          aggs: {
            customers: {
              terms: {
                field: "metadata.customer_id",
                size: 10000,
              },
            },
            labels: {
              terms: {
                field: "metadata.labels",
                size: 10000,
              },
            },
          },
        },
      });

      const customers: { key: string; doc_count: number }[] =
        (customersLabelsResult.aggregations?.customers as any)?.buckets ?? [];
      const labels: { key: string; doc_count: number }[] =
        (customersLabelsResult.aggregations?.labels as any)?.buckets ?? [];

      return {
        customers: customers.map((bucket) => bucket.key),
        labels: labels.map((bucket) => bucket.key),
      };
    }),
  getTracesByThreadId: protectedProcedure
    .input(z.object({ projectId: z.string(), threadId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input }) => {
      const { projectId, threadId } = input;

      const tracesResult = await esClient.search<Trace>({
        index: TRACE_INDEX,
        body: {
          query: {
            //@ts-ignore
            bool: {
              filter: [
                { term: { project_id: projectId } },
                { term: { "metadata.thread_id": threadId } },
              ],
            },
          },
          sort: [
            {
              "timestamps.started_at": {
                order: "asc",
              },
            },
          ],
          size: 1000,
        },
      });

      const traces = tracesResult.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x);

      return traces;
    }),

  getTracesWithSpans: protectedProcedure
    .input(z.object({ projectId: z.string(), traceIds: z.array(z.string()) }))
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input }) => {
      const { projectId, traceIds } = input;

      const tracesResult = await esClient.search<Trace>({
        index: TRACE_INDEX,
        body: {
          query: {
            //@ts-ignore
            bool: {
              filter: [
                { term: { project_id: projectId } },
                { terms: { trace_id: traceIds } },
              ],
            },
          },
          sort: [
            {
              "timestamps.started_at": {
                order: "asc",
              },
            },
          ],
          size: 1000,
        },
      });

      const traces = tracesResult.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x);

      const spansByTraceId = await Promise.all(
        traces.map((trace) =>
          esGetSpansByTraceId({ traceId: trace.trace_id, projectId })
        )
      );

      const tracesWithSpans = traces.map((trace, i) => ({
        ...trace,
        spans: spansByTraceId[i],
      }));

      for (const tracesWithSpan of tracesWithSpans) {
        delete tracesWithSpan.input?.embeddings;
        delete tracesWithSpan.output?.embeddings;
      }

      return tracesWithSpans;
    }),
});

const groupTraces = (groupBy: string | undefined, traces: Trace[]) => {
  const groups: Trace[][] = [];

  const groupingKeyPresent = (trace: Trace) => {
    if (groupBy === "input") {
      return !!trace.input?.embeddings?.embeddings;
    }
    if (groupBy === "output") {
      return !!trace.output?.embeddings?.embeddings;
    }
    if (groupBy === "user_id") {
      return !!trace.metadata.user_id;
    }
    if (groupBy === "thread_id") {
      return !!trace.metadata.thread_id;
    }

    return false;
  };

  const matchesGroup = (trace: Trace, member: Trace) => {
    if (groupBy === "input") {
      const similarityThreshold = 0.85;
      return (
        (similarity(
          trace.input.embeddings!.embeddings,
          member.input.embeddings!.embeddings
        ) ?? 0) > similarityThreshold
      );
    }
    if (groupBy === "output") {
      const similarityThreshold = 0.9;
      return (
        (similarity(
          trace.output!.embeddings!.embeddings,
          member.output!.embeddings!.embeddings
        ) ?? 0) > similarityThreshold
      );
    }
    if (groupBy === "user_id") {
      return trace.metadata.user_id === member.metadata.user_id;
    }
    if (groupBy === "thread_id") {
      return trace.metadata.thread_id === member.metadata.thread_id;
    }

    return false;
  };

  for (const trace of traces) {
    if (!groupingKeyPresent(trace)) {
      groups.push([trace]);
      continue;
    }

    let grouped = false;
    for (const group of groups) {
      for (const member of group) {
        if (!groupingKeyPresent(member)) continue;

        if (matchesGroup(trace, member)) {
          group.push(trace);
          grouped = true;
          break;
        }
      }
      if (grouped) break;
    }
    if (!grouped) {
      groups.push([trace]);
    }
  }

  return groups;
};
