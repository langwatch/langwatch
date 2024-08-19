import { z } from "zod";

import type {
  QueryDslBoolQuery,
  SearchTotalHits,
} from "@elastic/elasticsearch/lib/api/types";
import { PublicShareResourceTypes, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import similarity from "compute-cosine-similarity";
import shuffle from "lodash/shuffle";
import type { Session } from "next-auth";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { prisma } from "~/server/db";
import { evaluatorsSchema } from "../../../trace_checks/evaluators.zod.generated";
import { evaluatePreconditions } from "../../../trace_checks/preconditions";
import { checkPreconditionSchema } from "../../../trace_checks/types.generated";

import { sharedFiltersInputSchema } from "../../analytics/types";
import { TRACE_INDEX, esClient, traceIndexId } from "../../elasticsearch";
import { getOpenAIEmbeddings } from "../../embeddings";
import {
  type ElasticSearchSpan,
  type ElasticSearchTrace,
  type GuardrailResult,
  type RAGChunk,
  type Trace,
} from "../../tracer/types";
import {
  elasticSearchSpanToSpan,
  elasticSearchTraceToTrace,
} from "../../tracer/utils";
import {
  TeamRoleGroup,
  backendHasTeamProjectPermission,
  checkPermissionOrPubliclyShared,
  checkUserPermissionForProject,
} from "../permission";
import { generateTracesPivotQueryConditions } from "./analytics/common";

const tracesFilterInput = sharedFiltersInputSchema.extend({
  pageOffset: z.number().optional(),
  pageSize: z.number().optional(),
});

const getAllForProjectInput = tracesFilterInput.extend({
  query: z.string().optional(),
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
  updatedAt: z.number().optional(),
});

export const esGetSpansByTraceId = async ({
  traceId,
  projectId,
}: {
  traceId: string;
  projectId: string;
}): Promise<ElasticSearchSpan[]> => {
  const result = await esClient.search<ElasticSearchTrace>({
    index: TRACE_INDEX.alias,
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

  return result.hits.hits
    .map((hit) => hit._source!)
    .filter((hit) => hit)
    .flatMap((hit) => hit.spans ?? []);
};

export const tracesRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(getAllForProjectInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ ctx, input }) => {
      return await getAllTracesForProject(input, ctx);
    }),
  getById: publicProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(
      checkPermissionOrPubliclyShared(
        checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW),
        {
          resourceType: PublicShareResourceTypes.TRACE,
          resourceParam: "traceId",
        }
      )
    )
    .query(async ({ ctx, input }) => {
      const canSeeCosts =
        ctx.publiclyShared ||
        (await backendHasTeamProjectPermission(
          ctx,
          input,
          TeamRoleGroup.COST_VIEW
        ));

      const trace = await getTraceById({
        projectId: input.projectId,
        traceId: input.traceId,
        canSeeCosts,
      });

      if (!trace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trace not found." });
      }

      return trace;
    }),
  getEvaluations: publicProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(
      checkPermissionOrPubliclyShared(
        checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW),
        {
          resourceType: PublicShareResourceTypes.TRACE,
          resourceParam: "traceId",
        }
      )
    )
    .query(async ({ input }) => {
      return (
        await getEvaluationsMultiple({
          projectId: input.projectId,
          traceIds: [input.traceId],
        })
      )[input.traceId];
    }),
  getEvaluationsMultiple: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceIds: z.array(z.string()),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input }) => {
      return getEvaluationsMultiple(input);
    }),
  getTopicCounts: protectedProcedure
    .input(tracesFilterInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input, ctx }) => {
      const { pivotIndexConditions } =
        generateTracesPivotQueryConditions(input);

      const topicCountsResult = await esClient.search<ElasticSearchTrace>({
        index: TRACE_INDEX.alias,
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
                field: "metadata.topic_id",
                size: 10000,
              },
            },
            subtopicCounts: {
              terms: {
                field: "metadata.subtopic_id",
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
      const customersLabelsResult = await esClient.search<ElasticSearchTrace>({
        index: TRACE_INDEX.alias,
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

      return getTracesByThreadId({ projectId, threadId });
    }),

  getTracesWithSpans: protectedProcedure
    .input(z.object({ projectId: z.string(), traceIds: z.array(z.string()) }))
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input }) => {
      const { projectId, traceIds } = input;

      return getTracesWithSpans(projectId, traceIds);
    }),

  getSampleTraces: protectedProcedure
    .input(
      tracesFilterInput.extend({
        query: z.string().optional(),
        sortBy: z.string().optional(),
        evaluatorType: evaluatorsSchema.keyof(),
        preconditions: z.array(checkPreconditionSchema),
        expectedResults: z.number(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ ctx, input }) => {
      const { groups } = await getAllTracesForProject(
        {
          ...input,
          groupBy: "none",
          pageSize: 100,
        },
        ctx
      );
      const traceIds = groups.flatMap((group) =>
        group.map((trace) => trace.trace_id)
      );

      if (traceIds.length === 0) {
        return [];
      }

      const { projectId, evaluatorType, preconditions, expectedResults } =
        input;

      const traceWithSpans = await getTracesWithSpans(projectId, traceIds);

      const passedPreconditions = traceWithSpans.filter(
        (trace) =>
          evaluatorType &&
          evaluatePreconditions(
            evaluatorType,
            trace,
            trace.spans?.map(elasticSearchSpanToSpan) ?? [],
            preconditions
          )
      );
      const passedPreconditionsTraceIds = passedPreconditions?.map(
        (trace) => trace.trace_id
      );

      let samples = shuffle(passedPreconditions)
        .slice(0, expectedResults)
        .map((sample) => ({ ...sample, passesPreconditions: true }));
      if (samples.length < 10) {
        samples = samples.concat(
          shuffle(
            traceWithSpans.filter(
              (trace) => !passedPreconditionsTraceIds?.includes(trace.trace_id)
            )
          )
            .slice(0, expectedResults - samples.length)
            .map((sample) => ({ ...sample, passesPreconditions: false }))
        );
      }

      return samples;
    }),

  getAllForDownload: protectedProcedure
    .input(getAllForProjectInput.extend({ includeContexts: z.boolean() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .mutation(async ({ ctx, input }) => {
      return await getAllTracesForProject(
        { ...input, pageOffset: 0, pageSize: 10_000 },
        ctx,
        true,
        input.includeContexts
      );
    }),
});

export const getAllTracesForProject = async (
  input: z.infer<typeof getAllForProjectInput>,
  ctx?: { prisma: PrismaClient; session: Session },
  downloadMode = false,
  includeContexts = true
) => {
  const embeddings = input.query
    ? await getOpenAIEmbeddings(input.query, input.projectId)
    : undefined;

  console.log(embeddings);
  if (input.query && !embeddings) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get embeddings for query.",
    });
  }

  const { pivotIndexConditions } = generateTracesPivotQueryConditions(input);

  let pageSize = input.pageSize ? input.pageSize : 25;
  const pageOffset = input.pageOffset ? input.pageOffset : 0;

  let totalHits = 0;

  if (input.updatedAt !== undefined && input.updatedAt >= 0) {
    pageSize = 10_000;
  }

  let canSeeCosts = false;
  if (ctx?.prisma) {
    canSeeCosts =
      (await backendHasTeamProjectPermission(
        ctx,
        input,
        TeamRoleGroup.COST_VIEW
      )) ?? false;
  }

  //@ts-ignore
  const tracesResult = await esClient.search<ElasticSearchTrace>({
    index: TRACE_INDEX.alias,
    from: pageOffset,
    size: pageSize,
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
        ...(downloadMode ? ["spans"] : ["spans.input.value", "spans.error"]),
      ],
    },
    ...(downloadMode && includeContexts
      ? {
          // Retrieve only contexts for download, ignore guardrails and all other spans
          script_fields: {
            context_spans: {
              script: {
                lang: "painless",
                source: `
                  def spans = [];
                  for (def span : params._source.spans) {
                    // if (span.contexts != null && span.contexts.length > 0) {
                      // spans.add([
                      //   'contexts': span.contexts
                      // ]);
                    // }
                    spans.add(span)
                  }
                  return spans;
                `,
              },
            },
          },
        }
      : {}),
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
              bool: {
                must: pivotIndexConditions,
              },
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
            // Ensures proper filters are applied even with knn
            post_filter: pivotIndexConditions,
          }
        : {}),
    },
  });

  const guardrailsSlugToName = Object.fromEntries(
    (
      await prisma.check.findMany({
        where: {
          projectId: input.projectId,
        },
        select: {
          slug: true,
          name: true,
        },
      })
    ).map((guardrail) => [guardrail.slug, guardrail.name])
  );

  const traces = tracesResult.hits.hits
    .filter((x) => x._source)
    .map((hit) => {
      const trace = hit._source!;
      const spans =
        (hit.fields?.context_spans as ElasticSearchSpan[] | undefined) ??
        trace.spans;

      const lastSpans = spans?.reverse();
      const lastNonGuardrailSpanIndex =
        lastSpans?.findIndex((span) => span.type !== "guardrail") ?? -1;
      const lastGuardrailSpans =
        lastNonGuardrailSpanIndex > -1
          ? lastSpans?.slice(0, lastNonGuardrailSpanIndex)
          : lastSpans;

      const lastFailedGuardrailResult:
        | (GuardrailResult & { name?: string })
        | undefined = lastGuardrailSpans?.flatMap((span) =>
        (span?.output ? [span.output] : [])
          .filter((output) => output.type === "guardrail_result")
          .map((output) => ({
            ...((output.value as unknown as GuardrailResult) || {}),
            name: guardrailsSlugToName[span.name ?? ""],
          }))
          .filter((output) => !(output as GuardrailResult)?.passed)
      )[0];

      let contexts: RAGChunk[] = [];
      for (const span of spans ?? []) {
        if ("contexts" in span && Array.isArray(span.contexts)) {
          contexts = [...contexts, ...span.contexts];
        }
      }

      return {
        ...elasticSearchTraceToTrace(trace),
        lastGuardrail: lastFailedGuardrailResult,
        contexts,
      };
    });

  const groups = groupTraces(input.groupBy, traces);

  // Remove embeddings to reduce payload size
  for (const group of groups) {
    for (const trace of group) {
      delete trace.input?.embeddings;
      delete trace.output?.embeddings;
    }
  }

  totalHits = (tracesResult.hits?.total as SearchTotalHits)?.value || 0;

  const evaluations = Object.fromEntries(
    tracesResult.hits.hits
      .map((hit) => hit._source!)
      .filter((x) => x)
      .map((trace) => [trace.trace_id, trace.evaluations ?? []])
  );

  return { groups, totalHits, traceChecks: evaluations };
};

export const getSpansForTraceIds = async (
  projectId: string,
  traceIds: string[]
) => {
  const batchSize = 300; // Around the maximum IDs that ES supports without blowing up
  const searchPromises = [];

  for (let i = 0; i < traceIds.length; i += batchSize) {
    const batchTraceIds = traceIds.slice(i, i + batchSize);

    const searchPromise = esClient.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      body: {
        size: 10_000,
        _source: ["trace_id", "spans"],
        query: {
          bool: {
            filter: [
              { terms: { trace_id: batchTraceIds } },
              { term: { project_id: projectId } },
            ] as QueryDslBoolQuery["filter"],
          } as QueryDslBoolQuery,
        },
      },
    });
    searchPromises.push(searchPromise);
  }
  const results = await Promise.all(searchPromises);

  return Object.fromEntries(
    results
      .flatMap((result) => result.hits.hits)
      .map((hit) => hit._source!)
      .filter((x) => x)
      .map((trace) => [
        trace.trace_id,
        (trace.spans ?? []).map(elasticSearchSpanToSpan),
      ])
  );
};

const getTracesWithSpans = async (projectId: string, traceIds: string[]) => {
  const tracesResult = await esClient.search<ElasticSearchTrace>({
    index: TRACE_INDEX.alias,
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
      // Remove embeddings to reduce payload size
      _source: {
        excludes: [
          "input.embeddings",
          "input.embeddings.embeddings",
          "output.embeddings",
          "output.embeddings.embeddings",
        ],
      },
    },
  });

  const traces = tracesResult.hits.hits
    .map((hit) => hit._source!)
    .filter((x) => x)
    .map((trace) => {
      const spans = trace.spans ?? [];
      return {
        ...elasticSearchTraceToTrace(trace),
        spans,
      };
    });

  return traces;
};

const groupTraces = <T extends Trace>(
  groupBy: string | undefined,
  traces: T[]
) => {
  const groups: T[][] = [];

  const groupingKeyPresent = (trace: T) => {
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

  const matchesGroup = (trace: T, member: T) => {
    if (groupBy === "input") {
      const similarityThreshold = 0.85;
      if (
        !trace.input?.embeddings?.embeddings ||
        !member.input?.embeddings?.embeddings
      ) {
        return false;
      }

      return (
        (similarity(
          trace.input.embeddings.embeddings,
          member.input.embeddings.embeddings
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

export const getEvaluationsMultiple = async (input: {
  projectId: string;
  traceIds: string[];
}) => {
  const { projectId, traceIds } = input;

  const checksResult = await esClient.search<ElasticSearchTrace>({
    index: TRACE_INDEX.alias,
    _source: ["trace_id", "evaluations"],
    body: {
      size: Math.min(traceIds.length * 100, 10_000), // Assuming a maximum of 100 checks per trace
      query: {
        bool: {
          filter: [
            { terms: { trace_id: traceIds } },
            { term: { project_id: projectId } },
          ] as QueryDslBoolQuery["filter"],
        } as QueryDslBoolQuery,
      },
    },
  });

  const traces = checksResult.hits.hits
    .map((hit) => hit._source!)
    .filter((x) => x);

  return Object.fromEntries(
    traces.map((trace) => [trace.trace_id, trace.evaluations ?? []])
  );
};

export const getTraceById = async ({
  projectId,
  traceId,
  canSeeCosts,
}: {
  projectId: string;
  traceId: string;
  canSeeCosts?: boolean | undefined | null;
}) => {
  const result = await esClient.search<ElasticSearchTrace>({
    index: TRACE_INDEX.alias,
    size: 1,
    _source: {
      // TODO: do we really need to exclude both keys and nested keys for embeddings?
      excludes: [
        "input.embeddings",
        "input.embeddings.embeddings",
        "output.embeddings",
        "output.embeddings.embeddings",
        ...(canSeeCosts ? [] : ["metrics.total_cost"]),
        "spans",
        "evaluations",
      ],
    },
    body: {
      query: {
        //@ts-ignore
        bool: {
          filter: [
            { term: { trace_id: traceId } },
            { term: { project_id: projectId } },
          ],
        } as QueryDslBoolQuery,
      },
    },
  });

  const trace = result.hits.hits[0]?._source;
  return trace ? elasticSearchTraceToTrace(trace) : undefined;
};

export const getTracesByThreadId = async ({
  projectId,
  threadId,
}: {
  projectId: string;
  threadId: string;
}) => {
  const tracesResult = await esClient.search<ElasticSearchTrace>({
    index: TRACE_INDEX.alias,
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
      // Remove embeddings to reduce payload size
      _source: {
        excludes: [
          "input.embeddings",
          "input.embeddings.embeddings",
          "output.embeddings",
          "output.embeddings.embeddings",
        ],
      },
      size: 1000,
    },
  });

  const traces = tracesResult.hits.hits
    .map((hit) => hit._source!)
    .filter((x) => x)
    .map(elasticSearchTraceToTrace);

  return traces;
};
