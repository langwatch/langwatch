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
import { checkUserPermissionForProject } from "../permission";

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
    size: 1000,
  });

  return result.hits.hits.map((hit) => hit._source!).filter((hit) => hit);
};

export const tracesRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.number(),
        endDate: z.number(),
        query: z.string().optional(),
        groupBy: z.string().optional(),
        user_id: z.string().optional(),
        thread_id: z.string().optional(),
      })
    )
    .use(checkUserPermissionForProject)
    .query(async ({ input }) => {
      const embeddings = input.query
        ? await getOpenAIEmbeddings(input.query)
        : [];

      // If end date is very close to now, force it to be now, to allow frontend to keep refetching for new messages
      const endDate =
        new Date().getTime() - input.endDate < 1000 * 60 * 60
          ? new Date().getTime()
          : input.endDate;

      const queryConditions = [
        {
          term: { project_id: input.projectId },
        },
        {
          range: {
            "timestamps.started_at": {
              gte: input.startDate,
              lte: endDate,
              format: "epoch_millis",
            },
          },
        },
        ...(input.user_id ? [{ term: { user_id: input.user_id } }] : []),
        ...(input.thread_id ? [{ term: { thread_id: input.thread_id } }] : []),
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
    .use(checkUserPermissionForProject)
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
    .use(checkUserPermissionForProject)
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
      return !!trace.user_id;
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
      return trace.user_id === member.user_id;
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
