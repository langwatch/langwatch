import { PublicShareResourceTypes } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import shuffle from "lodash-es/shuffle";
import { on } from "node:events";
import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { getApp } from "~/server/app-layer";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";
import { TraceService } from "~/server/traces/trace.service";
import { createLogger } from "~/utils/logger/server";
import { sharedFiltersInputSchema } from "../../analytics/types";
import { evaluatorsSchema } from "../../evaluations/evaluators.zod.generated";
import { evaluatePreconditions } from "../../evaluations/preconditions";
import { checkPreconditionSchema } from "../../evaluations/types.generated";
import { checkPermissionOrPubliclyShared, checkProjectPermission } from "../rbac";
import { getUserProtectionsForProject } from "../utils";

const tracesFilterInput = sharedFiltersInputSchema.extend({
  pageOffset: z.number().optional(),
  pageSize: z.number().optional(),
});

export const getAllForProjectInput = tracesFilterInput.extend({
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
  updatedAt: z.number().optional(),
  scrollId: z.string().optional().nullable(),
});

const logger = createLogger("langwatch:traces:sse-subscription");

export const tracesRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(getAllForProjectInput)
    .use(checkProjectPermission("traces:view"))
    .query(async ({ ctx, input }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      return traceService.getAllTracesForProject(input, protections);
    }),

  getById: publicProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(
      checkPermissionOrPubliclyShared(checkProjectPermission("traces:view"), {
        resourceType: PublicShareResourceTypes.TRACE,
        resourceParam: "traceId",
      }),
    )
    .query(async ({ ctx, input }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      const trace = await traceService.getById(
        input.projectId,
        input.traceId,
        protections,
      );

      if (!trace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trace not found." });
      }

      return trace;
    }),

  getEvaluations: publicProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(
      checkPermissionOrPubliclyShared(checkProjectPermission("traces:view"), {
        resourceType: PublicShareResourceTypes.TRACE,
        resourceParam: "traceId",
      }),
    )
    .query(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      const evaluations = await traceService.getEvaluationsMultiple(
        input.projectId,
        [input.traceId],
        protections,
      );

      return evaluations[input.traceId];
    }),

  getEvaluationsMultiple: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        traceIds: z.array(z.string()),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      return traceService.getEvaluationsMultiple(
        input.projectId,
        input.traceIds,
        protections,
      );
    }),

  getTopicCounts: protectedProcedure
    .input(tracesFilterInput)
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const traceService = TraceService.create(ctx.prisma);
      const result = await traceService.getTopicCounts(input);

      const topicsMap = Object.fromEntries(
        (
          await ctx.prisma.topic.findMany({
            where: {
              projectId: input.projectId,
            },
            select: { id: true, name: true, parentId: true },
          })
        ).map((topic) => [topic.id, topic]),
      );

      const mapBuckets = (
        buckets: Array<{ key: string; count: number }>,
        includeParent = false,
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
                count: bucket.count,
                ...(includeParent && { parentId: topic.parentId }),
              },
            ];
          },
          [] as {
            id: string;
            name: string;
            count: number;
            parentId?: string | null;
          }[],
        );
      };

      const topicCounts = mapBuckets(result.topicCounts);
      const subtopicCounts = mapBuckets(result.subtopicCounts, true);

      return { topicCounts, subtopicCounts };
    }),

  getCustomersAndLabels: protectedProcedure
    .input(tracesFilterInput)
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const traceService = TraceService.create(ctx.prisma);
      return traceService.getCustomersAndLabels(input);
    }),

  getTracesByThreadId: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        threadId: z.string(),
        traceId: z.string(),
      }),
    )
    .use(
      checkPermissionOrPubliclyShared(checkProjectPermission("traces:view"), {
        resourceType: PublicShareResourceTypes.TRACE,
        resourceParam: "traceId",
      }),
    )
    .query(async ({ input, ctx }) => {
      const { projectId, threadId } = input;

      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      const tracesGrouped = await traceService.getTracesByThreadId(
        projectId,
        threadId,
        protections,
      );

      if (!ctx.publiclyShared) {
        return tracesGrouped;
      }

      const publicSharedTraces = await ctx.prisma.publicShare.findMany({
        where: {
          projectId: projectId,
          resourceType: PublicShareResourceTypes.TRACE,
          resourceId: {
            in: tracesGrouped.map((trace) => trace.trace_id),
          },
        },
      });

      const filteredTraces = tracesGrouped.filter((trace) =>
        publicSharedTraces.some(
          (publicShare) => publicShare.resourceId === trace.trace_id,
        ),
      );

      return filteredTraces;
    }),

  getTracesWithSpans: protectedProcedure
    .input(z.object({ projectId: z.string(), traceIds: z.array(z.string()) }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const { projectId, traceIds } = input;
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      return traceService.getTracesWithSpans(projectId, traceIds, protections);
    }),

  getFormattedSpansDigest: protectedProcedure
    .input(
      z.object({ projectId: z.string(), traceIds: z.array(z.string()) }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const { projectId, traceIds } = input;
      const protections = await getUserProtectionsForProject(ctx, {
        projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      const traces = await traceService.getTracesWithSpans(
        projectId,
        traceIds,
        protections,
      );

      return Object.fromEntries(
        await Promise.all(traces.map(async (t) => [t.trace_id, await formatSpansDigest(t.spans ?? [])])),
      );
    }),

  getTracesWithSpansByThreadIds: protectedProcedure
    .input(z.object({ projectId: z.string(), threadIds: z.array(z.string()) }))
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const { projectId, threadIds } = input;
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      return traceService.getTracesWithSpansByThreadIds(
        projectId,
        threadIds,
        protections,
      );
    }),

  getSampleTracesDataset: protectedProcedure
    .input(
      tracesFilterInput.extend({
        projectId: z.string(),
        query: z.string().optional(),
        sortBy: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ ctx, input }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      const { groups } = await traceService.getAllTracesForProject(
        {
          ...input,
          groupBy: "none",
          pageSize: 10,
        },
        protections,
      );

      const traceIds = groups.flatMap((group) =>
        group.map((trace) => trace.trace_id),
      );

      if (traceIds.length === 0) {
        return [];
      }

      return traceService.getTracesWithSpans(
        input.projectId,
        traceIds,
        protections,
      );
    }),

  getFieldNames: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        startDate: z.number(),
        endDate: z.number(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ ctx, input }) => {
      const traceService = TraceService.create(ctx.prisma);
      return traceService.getDistinctFieldNames(
        input.projectId,
        input.startDate,
        input.endDate,
      );
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
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ ctx, input }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      const { groups } = await traceService.getAllTracesForProject(
        {
          ...input,
          groupBy: "none",
          pageSize: 100,
        },
        protections,
      );

      const traceIds = groups.flatMap((group) =>
        group.map((trace) => trace.trace_id),
      );

      if (traceIds.length === 0) {
        return [];
      }

      const { projectId, evaluatorType, preconditions, expectedResults } =
        input;

      const traceWithSpans = await traceService.getTracesWithSpans(
        projectId,
        traceIds,
        protections,
      );

      const passedPreconditions = traceWithSpans.filter(
        (trace) =>
          evaluatorType &&
          evaluatePreconditions(
            evaluatorType,
            trace,
            trace.spans ?? [],
            preconditions,
          ),
      );
      const passedPreconditionsTraceIds = passedPreconditions?.map(
        (trace) => trace.trace_id,
      );

      let samples = shuffle(passedPreconditions)
        .slice(0, expectedResults)
        .map((sample) => ({ ...sample, passesPreconditions: true }));
      if (samples.length < 10) {
        samples = samples.concat(
          shuffle(
            traceWithSpans.filter(
              (trace) => !passedPreconditionsTraceIds?.includes(trace.trace_id),
            ),
          )
            .slice(0, expectedResults - samples.length)
            .map((sample) => ({ ...sample, passesPreconditions: false })),
        );
      }

      return samples;
    }),

  getAllForDownload: protectedProcedure
    .input(
      getAllForProjectInput.extend({
        includeSpans: z.boolean(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .mutation(async ({ ctx, input }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      return traceService.getAllTracesForProject(
        {
          ...input,
          pageOffset: input.pageOffset ?? 0,
          pageSize: input.pageSize ?? 10_000,
        },
        protections,
        {
          downloadMode: true,
          includeSpans: input.includeSpans,
          scrollId: input.scrollId,
        },
      );
    }),

  onTraceUpdate: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("traces:view"))
    .subscription(async function* (opts) {
      const { projectId } = opts.input;
      const emitter = getApp().broadcast.getTenantEmitter(projectId);

      logger.info({ projectId }, "SSE subscription started");

      try {
        for await (const eventArgs of on(emitter, "trace_updated", {
          // @ts-expect-error - signal is not typed
          signal: opts.signal,
        })) {
          logger.debug(
            { projectId, event: eventArgs[0] },
            "SSE event received",
          );
          yield eventArgs[0];
        }
        logger.info({ projectId }, "SSE subscription ended normally");
      } finally {
        logger.debug({ projectId }, "SSE subscription cleanup");
        getApp().broadcast.cleanupTenantEmitter(projectId);
      }
    }),
});
