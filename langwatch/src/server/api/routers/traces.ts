import { z } from "zod";

import { TRPCError } from "@trpc/server";
import similarity from "compute-cosine-similarity";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  SPAN_INDEX,
  TRACE_CHECKS_INDEX,
  TRACE_INDEX,
  esClient,
} from "../../elasticsearch";
import { getOpenAIEmbeddings } from "../../embeddings";
import type { ElasticSearchSpan, Trace, TraceCheck } from "../../tracer/types";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

const sharedTraceFilterInput = z.object({
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
}: z.infer<typeof sharedTraceFilterInput>) => {
  // If end date is very close to now, force it to be now, to allow frontend to keep refetching for new messages
  const endDate_ =
    new Date().getTime() - endDate < 1000 * 60 * 60 * 2
      ? new Date().getTime()
      : endDate;

  return [
    {
      term: { project_id: projectId },
    },
    {
      range: {
        "timestamps.started_at": {
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

export const esGetTraceById = async (
  traceId: string
): Promise<Trace | undefined> => {
  const result = await esClient.search<Trace>({
    index: TRACE_INDEX,
    body: {
      query: {
        term: { id: traceId },
      },
    },
    size: 1,
  });

  return result.hits.hits[0]?._source;
};

export const esGetSpansByTraceId = async (
  traceId: string
): Promise<ElasticSearchSpan[]> => {
  const result = await esClient.search<ElasticSearchSpan>({
    index: SPAN_INDEX,
    body: {
      query: {
        term: { trace_id: traceId },
      },
    },
    size: 10000,
  });

  return result.hits.hits.map((hit) => hit._source!).filter((hit) => hit);
};

export const tracesRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(
      sharedTraceFilterInput.extend({
        query: z.string().optional(),
        groupBy: z.string().optional(),
        topics: z.array(z.string()).optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input }) => {
      const embeddings = input.query
        ? await getOpenAIEmbeddings(input.query)
        : [];

      const queryConditions = [
        ...generateQueryConditions(input),
        ...(input.topics ? [{ terms: { topics: input.topics } }] : []),
      ];

      //@ts-ignore
      const tracesResult = await esClient.search<Trace>({
        index: TRACE_INDEX,
        size: 100,
        _source: {
          excludes: [
            "search_embeddings.openai_embeddings",
            ...(input.groupBy !== "input" ? ["input.openai_embeddings"] : []),
            ...(input.groupBy !== "output" ? ["output.openai_embeddings"] : []),
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
                ...queryConditions,
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
                  field: "search_embeddings.openai_embeddings",
                  query_vector: embeddings,
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
              must: queryConditions,
            },
          },
        },
      });

      const traces = tracesResult.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x);

      const groups = groupTraces(input.groupBy, traces);

      // Remove embeddings to reduce payload size
      for (const group of groups) {
        for (const trace of group) {
          delete trace.input?.openai_embeddings;
          delete trace.output?.openai_embeddings;
        }
      }

      return groups;
    }),
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input }) => {
      const result = await esClient.search<Trace>({
        index: TRACE_INDEX,
        body: {
          query: {
            //@ts-ignore
            bool: {
              filter: [
                { term: { id: input.traceId } },
                { term: { project_id: input.projectId } },
              ],
            },
          },
        },
        size: 1,
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
    .input(sharedTraceFilterInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input }) => {
      const queryConditions = generateQueryConditions(input);

      const topicCountsResult = await esClient.search<Trace>({
        index: TRACE_INDEX,
        size: 0, // We do not need the actual documents, just the aggregations
        body: {
          query: {
            //@ts-ignore
            bool: {
              //@ts-ignore
              must: queryConditions,
            },
          },
          aggs: {
            topicCounts: {
              terms: {
                field: "topics",
                size: 10000,
              },
            },
          },
        },
      });

      const buckets: { key: string; doc_count: number }[] =
        (topicCountsResult.aggregations?.topicCounts as any)?.buckets ?? [];
      const topicCounts = buckets.reduce(
        (acc, bucket) => {
          acc[bucket.key] = bucket.doc_count;
          return acc;
        },
        {} as Record<string, number>
      );

      return topicCounts;
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
                field: "customer_id",
                size: 10000,
              },
            },
            labels: {
              terms: {
                field: "labels",
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
                { term: { thread_id: threadId } },
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
});

const groupTraces = (groupBy: string | undefined, traces: Trace[]) => {
  const groups: Trace[][] = [];

  const groupingKeyPresent = (trace: Trace) => {
    if (groupBy === "input") {
      return !!trace.input?.openai_embeddings;
    }
    if (groupBy === "output") {
      return !!trace.output?.openai_embeddings;
    }
    if (groupBy === "user_id") {
      return !!trace.user_id;
    }
    if (groupBy === "thread_id") {
      return !!trace.thread_id;
    }

    return false;
  };

  const matchesGroup = (trace: Trace, member: Trace) => {
    if (groupBy === "input") {
      const similarityThreshold = 0.85;
      return (
        (similarity(
          trace.input.openai_embeddings!,
          member.input.openai_embeddings!
        ) ?? 0) > similarityThreshold
      );
    }
    if (groupBy === "output") {
      const similarityThreshold = 0.9;
      return (
        (similarity(
          trace.output!.openai_embeddings!,
          member.output!.openai_embeddings!
        ) ?? 0) > similarityThreshold
      );
    }
    if (groupBy === "user_id") {
      return trace.user_id === member.user_id;
    }
    if (groupBy === "thread_id") {
      return trace.thread_id === member.thread_id;
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
