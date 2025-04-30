import { z } from "zod";

import {
  type SearchResponse,
  type SearchTotalHits,
  type Sort,
} from "@elastic/elasticsearch/lib/api/types";
import { PublicShareResourceTypes, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import shuffle from "lodash/shuffle";
import type { Session } from "next-auth";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { prisma } from "~/server/db";
import { evaluatorsSchema } from "../../evaluations/evaluators.zod.generated";
import { evaluatePreconditions } from "../../evaluations/preconditions";
import { checkPreconditionSchema } from "../../evaluations/types.generated";
import type { Protections } from "../../elasticsearch/protections";

import { getAnnotatedTraceIds } from "~/server/filters/annotations";
import { sharedFiltersInputSchema } from "../../analytics/types";
import { TRACE_INDEX, esClient } from "../../elasticsearch";
import {
  type ElasticSearchTrace,
  type EvaluationResult,
  type RAGChunk,
  type Trace,
} from "../../tracer/types";
import {
  TeamRoleGroup,
  checkPermissionOrPubliclyShared,
  checkUserPermissionForProject,
} from "../permission";
import { generateTracesPivotQueryConditions } from "./analytics/common";
import { aggregateTraces, getTraceById, getTracesGroupedByThreadId, searchTraces,  } from "~/server/elasticsearch/traces";
import { getUserProtectionsForProject } from "../utils";
import { transformElasticSearchTraceToTrace } from "~/server/elasticsearch/transformers";
import type { TraceWithGuardrail } from "~/components/messages/MessageCard";

const tracesFilterInput = sharedFiltersInputSchema.extend({
  pageOffset: z.number().optional(),
  pageSize: z.number().optional(),
});

export const getAllForProjectInput = tracesFilterInput.extend({
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
  updatedAt: z.number().optional(),
});

export const tracesRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(getAllForProjectInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ ctx, input }) => {
      return await getAllTracesForProject({ input, ctx });
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
      const trace = await getTraceById({
        connConfig: { projectId: input.projectId },
        traceId: input.traceId,
        includeEvaluations: false,
        includeSpans: false,
        protections: await getUserProtectionsForProject(ctx, { projectId: input.projectId }),
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
    .query(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, { projectId: input.projectId });
      return (
        await getEvaluationsMultiple({
          projectId: input.projectId,
          traceIds: [input.traceId],
          protections,
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
    .query(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, { projectId: input.projectId });
      return getEvaluationsMultiple({
        projectId: input.projectId,
        traceIds: input.traceIds,
        protections,
      });
    }),
  getTopicCounts: protectedProcedure
    .input(tracesFilterInput)
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input, ctx }) => {
      const { pivotIndexConditions } =
        generateTracesPivotQueryConditions(input);

      const result = await aggregateTraces({
        connConfig: { projectId: input.projectId },
        search: {
          query: {
            bool: {
              must: pivotIndexConditions,
              should: void 0,
              must_not: void 0,
              filter: void 0,
            },
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
        buckets: Array<{ key: string; doc_count: number }>,
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
          [] as { id: string; name: string; count: number; parentId?: string | null }[]
        );
      };

      const topicCounts = mapBuckets(result.topicCounts);
      const subtopicCounts = mapBuckets(result.subtopicCounts, true);

      return { topicCounts, subtopicCounts };
    }),
  getCustomersAndLabels: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, { projectId: input.projectId });
      const result = await aggregateTraces({
        connConfig: { projectId: input.projectId },
        search: {
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
        protections,
      });

      return {
        customers: result.customers.map((bucket) => bucket.key),
        labels: result.labels.map((bucket) => bucket.key),
      };
    }),
  getTracesByThreadId: protectedProcedure
    .input(z.object({ projectId: z.string(), threadId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId, threadId } = input;
      const protections = await getUserProtectionsForProject(ctx, { projectId: input.projectId });

      return getTracesGroupedByThreadId({
        connConfig: { projectId },
        threadId,
        protections,
      });
    }),

  getTracesWithSpans: protectedProcedure
    .input(z.object({ projectId: z.string(), traceIds: z.array(z.string()) }))
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId, traceIds } = input;
      const protections = await getUserProtectionsForProject(ctx, { projectId: input.projectId });

      return getTracesWithSpans(projectId, traceIds, protections);
    }),

  getSampleTracesDataset: protectedProcedure
    .input(
      tracesFilterInput.extend({
        projectId: z.string(),
        query: z.string().optional(),
        sortBy: z.string().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ ctx, input }) => {
      const { groups } = await getAllTracesForProject({
        input: {
          ...input,
          groupBy: "none",
          pageSize: 10,
        },
        ctx,
      });
      const traceIds = groups.flatMap((group) =>
        group.map((trace) => trace.trace_id)
      );

      if (traceIds.length === 0) {
        return [];
      }

      const { projectId } = input;
      const protections = await getUserProtectionsForProject(ctx, { projectId: input.projectId });
      const traceWithSpans = await getTracesWithSpans(projectId, traceIds, protections);

      return traceWithSpans;
    }),

  getSampleTraces: protectedProcedure
    .input(
      tracesFilterInput.extend({
        query: z.string().optional(),
        sortBy: z.string().optional(),
        evaluatorType: evaluatorsSchema
          .keyof()
          .or(z.string().startsWith("custom/")),
        preconditions: z.array(checkPreconditionSchema),
        expectedResults: z.number(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .query(async ({ ctx, input }) => {
      const { groups } = await getAllTracesForProject({
        input: {
          ...input,
          groupBy: "none",
          pageSize: 100,
        },
        ctx,
      });
      const traceIds = groups.flatMap((group) =>
        group.map((trace) => trace.trace_id)
      );

      if (traceIds.length === 0) {
        return [];
      }

      const { projectId, evaluatorType, preconditions, expectedResults } =
        input;

      const protections = await getUserProtectionsForProject(ctx, { projectId: input.projectId });
      const traceWithSpans = await getTracesWithSpans(projectId, traceIds, protections);

      const passedPreconditions = traceWithSpans.filter(
        (trace) =>
          evaluatorType &&
          evaluatePreconditions(
            evaluatorType,
            trace,
            trace.spans ?? [],
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
    .input(
      getAllForProjectInput.extend({
        includeContexts: z.boolean(),
        scrollId: z.string().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.MESSAGES_VIEW))
    .mutation(async ({ ctx, input }) => {
      return await getAllTracesForProject({
        input: {
          ...input,
          pageOffset: input.pageOffset ?? 0,
          pageSize: input.pageSize ?? 10_000,
        },
        ctx,
        downloadMode: true,
        includeContexts: input.includeContexts,
        scrollId: input.scrollId,
      });
    }),
});

export const getAllTracesForProject = async ({
  input,
  ctx,
  downloadMode = false,
  includeContexts = true,
  scrollId = undefined,
}: {
  input: z.infer<typeof getAllForProjectInput>;
  ctx: {
    prisma: PrismaClient;
    session: Session | null;
    publiclyShared?: boolean;
  };
  downloadMode?: boolean;
  includeContexts?: boolean;
  scrollId?: string;
}) => {
  let traceIds: string[] = [];
  let shouldExcludeTraceIds = false;

  if (
    Array.isArray(input.filters["annotations.hasAnnotation"]) &&
    input.filters["annotations.hasAnnotation"].includes("true")
  ) {
    traceIds = await getAnnotatedTraceIds({
      projectId: input.projectId,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
    });

    shouldExcludeTraceIds =
      input.filters["annotations.hasAnnotation"].includes("false");
  } else if (
    Array.isArray(input.filters["annotations.hasAnnotation"]) &&
    input.filters["annotations.hasAnnotation"].includes("false") &&
    !input.filters["annotations.hasAnnotation"].includes("true")
  ) {
    traceIds = await getAnnotatedTraceIds({
      projectId: input.projectId,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
    });
    shouldExcludeTraceIds = true;
  }

  const { pivotIndexConditions } = generateTracesPivotQueryConditions({
    ...input,
    traceIds,
    filterForAnnotatedTraces: !shouldExcludeTraceIds,
  });

  let pageSize = input.pageSize ? input.pageSize : 25;
  const pageOffset = input.pageOffset ? input.pageOffset : 0;

  let totalHits = 0;
  if (input.updatedAt !== undefined && input.updatedAt >= 0) {
    pageSize = 10_000;
  }

  const protections = await getUserProtectionsForProject({
    prisma: ctx.prisma,
    session: ctx.session,
    publiclyShared: ctx.publiclyShared,
  }, { projectId: input.projectId });

  let tracesResult: SearchResponse<ElasticSearchTrace>;
  if (scrollId) {
    const client = await esClient({ projectId: input.projectId });
    tracesResult = await client.scroll({
      scroll_id: scrollId,
      scroll: "1m",
    });
  } else {
    const client = await esClient({ projectId: input.projectId });
    tracesResult = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      from: downloadMode ? undefined : pageOffset,
      size: pageSize,
      scroll: downloadMode ? "1m" : undefined,
      _source: {
        excludes: [
          "input.embeddings",
          "input.embeddings.embeddings",
          "output.embeddings",
          "output.embeddings.embeddings",
          ...(downloadMode ? ["spans"] : []),
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
                  if (params._source.spans != null) {
                    for (def span : params._source.spans) {
                      if (span.contexts != null && span.contexts.length > 0) {
                        def contextMap = new HashMap();
                        contextMap.put('contexts', span.contexts);
                        spans.add(contextMap);
                      }
                    }
                  }
                  return spans;
                `,
                },
              },
            },
          }
        : {}),
      body: {
        query: pivotIndexConditions,
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
            : input.sortBy.startsWith("evaluations.")
            ? {
                sort: {
                  "evaluations.score": {
                    order: input.sortDirection ?? "desc",
                    nested: {
                      path: "evaluations",
                      filter: {
                        term: {
                          "evaluations.evaluator_id":
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
                "timestamps.started_at": {
                  order: "desc",
                },
              } as Sort,
            }),
      },
    });
  }

  const traces = tracesResult.hits.hits.map((hit) => hit._source!).map(
    t => transformElasticSearchTraceToTrace(t, protections)
  );

  const guardrailsSlugToName = Object.fromEntries(
    (
      await prisma.monitor.findMany({
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

  if (input.groupBy === "thread_id") {
    const threadIds = traces.map((t) => t.metadata.thread_id).filter(Boolean);
    const existingTraceIds = new Set(traces.map((t) => t.trace_id));

    if (threadIds.length > 0) {
      const tracesFromThreadId = await searchTraces({
        connConfig: { projectId: input.projectId },
        search: {
          size: 100,
          query: {
            bool: {
              filter: [
                { terms: { "metadata.thread_id": threadIds } },
                { term: { project_id: input.projectId } },
              ],
              should: void 0,
              must_not: void 0,
            },
          },
        },
        protections,
      });
      const filteredTracesByThreadId = tracesFromThreadId.filter(
        (trace) => !existingTraceIds.has(trace.trace_id)
      );

      traces.unshift(...filteredTracesByThreadId);
    }
  }

  const tracesWithGuardrails = traces.map<TraceWithGuardrail>((trace) => {
    const spans = trace.spans ?? [];
    const lastSpans = [...spans].reverse();
    const lastNonGuardrailSpanIndex =
      lastSpans.findIndex((span) => span.type !== "guardrail") ?? -1;
    const lastGuardrailSpans =
      lastNonGuardrailSpanIndex > -1
        ? lastSpans.slice(0, lastNonGuardrailSpanIndex)
        : lastSpans;

    const lastFailedGuardrailResult:
      | (EvaluationResult & { name?: string })
      | undefined = lastGuardrailSpans?.flatMap((span) =>
      (span?.output ? [span.output] : [])
        .filter((output) => output.type === "guardrail_result")
        .map((output) => {
          let value = (output.value as unknown as EvaluationResult) || {};
          if (typeof value === "string") {
            try {
              value = JSON.parse(value);
            } catch {}
          }
          return {
            ...value,
            name: guardrailsSlugToName[span.name ?? ""],
          };
        })
        .filter((output) => !(output as EvaluationResult)?.passed)
    )[0];

    let contexts: RAGChunk[] = [];
    for (const span of spans ?? []) {
      if ("contexts" in span && Array.isArray(span.contexts)) {
        contexts = [...contexts, ...span.contexts];
      }
    }

    return {
      ...trace,
      lastGuardrail: lastFailedGuardrailResult,
      contexts,
    };
  });

  totalHits = (tracesResult.hits?.total as SearchTotalHits)?.value || 0;

  const evaluations = Object.fromEntries(
    traces
      .map((trace) => [trace.trace_id, trace.evaluations ?? []])
  );

  const groups = groupTraces(input.groupBy, tracesWithGuardrails)

  return {
    groups,
    totalHits,
    traceChecks: evaluations,
    scrollId: tracesResult._scroll_id,
  };
};

export const getTracesWithSpans = async (
  projectId: string,
  traceIds: string[],
  protections: Protections
) => {
  const traces = await searchTraces({
    connConfig: { projectId },
    protections,
    search: {
      index: TRACE_INDEX.alias,
      size: 1000,
      query: {
        bool: {
          filter: [
            { term: { project_id: projectId } },
            { terms: { trace_id: traceIds } },
          ],
          should: void 0,
          must_not: void 0,
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
    },
  });

  return traces;
};

const groupTraces = <T extends Trace>(
  groupBy: string | undefined,
  traces: T[]
) => {
  const groups: T[][] = [];

  const groupingKeyPresent = (trace: T) => {
    if (groupBy === "user_id") {
      return !!trace.metadata.user_id;
    }
    if (groupBy === "thread_id") {
      return !!trace.metadata.thread_id;
    }

    return false;
  };

  const matchesGroup = (trace: T, member: T) => {
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
  protections: Protections;
}) => {
  const { projectId, traceIds, protections } = input;

  const traces = await searchTraces({
    connConfig: { projectId },
    search: {
      index: TRACE_INDEX.alias,
      size: Math.min(traceIds.length * 100, 10_000), // Assuming a maximum of 100 checks per trace
      _source: ["trace_id", "evaluations"],
      query: {
        bool: {
          filter: [
            { terms: { trace_id: traceIds } },
            { term: { project_id: projectId } },
          ],
          should: void 0,
          must_not: void 0,
        },
      },
    },
    protections,
  });

  return Object.fromEntries(
    traces.map((trace) => [trace.trace_id, trace.evaluations ?? []])
  );
};
