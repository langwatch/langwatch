import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { Trace, TraceCheck } from "../../tracer/types";
import { TRACE_CHECKS_INDEX, TRACE_INDEX, esClient } from "../../elasticsearch";
import { TRPCError } from "@trpc/server";
import { checkUserPermissionForProject } from "../permission";
import { getOpenAIEmbeddings } from "../../embeddings";

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

export const tracesRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.number(),
        endDate: z.number(),
        query: z.string().optional(),
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

      //@ts-ignore
      const tracesResult = await esClient.search<Trace>({
        index: TRACE_INDEX,
        size: 100,
        _source: {
          excludes: [
            "input.openai_embeddings",
            "output.openai_embeddings",
            "search_embeddings.openai_embeddings",
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
                {
                  term: { project_id: input.projectId },
                },
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
              filter: {
                range: {
                  "timestamps.started_at": {
                    gte: input.startDate,
                    lte: endDate,
                    format: "epoch_millis",
                  },
                },
              },
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
              must: [
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
              ],
            },
          },
        },
      });

      const traces = tracesResult.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x);

      return traces;
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
