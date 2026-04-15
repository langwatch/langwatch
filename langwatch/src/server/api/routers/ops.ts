import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkOpsPermission } from "~/server/api/rbac";
import { getApp } from "~/server/app-layer/app";
import { getProjectionMetadata, getReactorMetadata } from "~/server/event-sourcing/pipelineRegistry";

const opsViewPermission = checkOpsPermission("ops:view");

const opsManagePermission = checkOpsPermission("ops:manage");

function requireOps() {
  const ops = getApp().ops;
  if (!ops) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Ops module is not available",
    });
  }
  return ops;
}

export const opsRouter = createTRPCRouter({
  getScope: protectedProcedure.use(opsViewPermission).query(({ ctx }) => {
    return { scope: ctx.opsScope! };
  }),

  getDashboardSnapshot: protectedProcedure
    .use(opsViewPermission)
    .query(() => {
      const ops = getApp().ops;
      if (!ops?.metricsCollector) return null;
      return ops.metricsCollector.getDashboardData();
    }),

  listQueues: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      const ops = requireOps();
      return ops.queues.getQueues();
    }),

  listGroups: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.getGroups(input);
    }),

  getGroupDetail: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      const group = await ops.queues.getGroupDetail(input);
      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Group "${input.groupId}" not found in queue "${input.queueName}"`,
        });
      }
      return group;
    }),

  getBlockedSummary: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      const ops = requireOps();
      return ops.queues.getBlockedSummary();
    }),

  getGroupJobs: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.getGroupJobs(input);
    }),

  unblockGroup: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.unblockGroup(input);
    }),

  unblockAll: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.unblockAll(input);
    }),

  drainGroup: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.drainGroup(input);
    }),

  pausePipeline: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        key: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.pausePipeline(input);
    }),

  unpausePipeline: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        key: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.unpausePipeline(input);
    }),

  retryBlocked: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.retryBlocked(input);
    }),

  listProjections: protectedProcedure
    .use(opsViewPermission)
    .query(() => {
      return {
        projections: getProjectionMetadata(),
        reactors: getReactorMetadata(),
      };
    }),

  discoverAggregates: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        projectionNames: z.array(z.string()).min(1),
        since: z.string(),
        tenantIds: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();

      return ops.eventExplorer.discoverAggregates({
        projectionNames: input.projectionNames,
        since: input.since,
        tenantIds: input.tenantIds ?? [],
      });
    }),

  searchTenants: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      return getApp().projects.searchByQuery({
        query: input.query,
      });
    }),

  dryRunReplay: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        projectionNames: z.array(z.string()).min(1),
        since: z.string(),
        tenantIds: z.array(z.string()),
        sampleSize: z.number().int().min(1).max(20).default(5),
      }),
    )
    .mutation(async ({ input }) => {
      return {
        status: "coming_soon" as const,
        message:
          "Dry run is not yet implemented. Full replay will process all aggregates.",
        projectionNames: input.projectionNames,
        sampleSize: input.sampleSize,
      };
    }),

  getReplayHistory: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      const ops = requireOps();
      return ops.replay.getHistory();
    }),

  getReplayRun: protectedProcedure
    .use(opsViewPermission)
    .input(z.object({ runId: z.string() }))
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.replay.findHistoryEntry({ runId: input.runId });
    }),

  startReplay: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        projectionNames: z.array(z.string()).min(1),
        since: z.string(),
        tenantIds: z.array(z.string()).optional(),
        aggregateIds: z.array(z.string()).optional(),
        description: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ops = requireOps();

      const userName =
        ctx.session.user.name ?? ctx.session.user.email ?? "unknown";

      try {
        return await ops.replay.startReplay({
          projectionNames: input.projectionNames,
          since: input.since,
          tenantIds: input.tenantIds ?? [],
          aggregateIds: input.aggregateIds,
          description: input.description,
          userName,
        });
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        const safeMessage = rawMessage.includes("already running")
          ? rawMessage
          : "Replay could not be started";
        throw new TRPCError({
          code: "CONFLICT",
          message: safeMessage,
        });
      }
    }),

  getReplayStatus: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      const ops = requireOps();
      return ops.replay.getStatus();
    }),

  cancelReplay: protectedProcedure
    .use(opsManagePermission)
    .mutation(async () => {
      const ops = requireOps();
      return ops.replay.cancelReplay();
    }),

  listDlqGroups: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.listDlqGroups(input);
    }),

  listAllDlqGroups: protectedProcedure
    .use(opsViewPermission)
    .query(async () => {
      const ops = requireOps();
      return ops.queues.getAllDlqGroups();
    }),

  listPausedKeys: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.listPausedKeys(input);
    }),

  drainAllBlockedPreview: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        queueName: z.string(),
        pipelineFilter: z.string().optional(),
        errorFilter: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.getDrainPreview(input);
    }),

  moveToDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.moveToDlq(input);
    }),

  moveAllBlockedToDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        pipelineFilter: z.string().optional(),
        errorFilter: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.moveAllBlockedToDlq(input);
    }),

  replayFromDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.replayFromDlq(input);
    }),

  replayAllFromDlq: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        pipelineFilter: z.string().optional(),
        errorFilter: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.replayAllFromDlq(input);
    }),

  canaryRedrive: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        count: z.number().int().min(1).max(100).default(5),
        pipelineFilter: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.canaryRedrive(input);
    }),

  canaryUnblock: protectedProcedure
    .use(opsManagePermission)
    .input(
      z.object({
        queueName: z.string(),
        count: z.number().int().min(1).max(100).default(5),
        pipelineFilter: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const ops = requireOps();
      return ops.queues.canaryUnblock(input);
    }),

  searchAggregates: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        query: z.string(),
        tenantId: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();

      return ops.eventExplorer.searchAggregates({
        query: input.query,
        tenantIds: input.tenantId ? [input.tenantId] : [],
      });
    }),

  loadAggregateEvents: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        aggregateId: z.string(),
        tenantId: z.string(),
        limit: z.number().int().min(1).max(5000).default(500),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();
      return ops.eventExplorer.getAggregateEvents(input);
    }),

  computeProjectionState: protectedProcedure
    .use(opsViewPermission)
    .input(
      z.object({
        aggregateId: z.string(),
        tenantId: z.string(),
        projectionName: z.string(),
        eventIndex: z.number().int().min(0),
      }),
    )
    .query(async ({ input }) => {
      const ops = requireOps();

      const result = await ops.eventExplorer.computeProjectionState(input);
      if (!result.aggregateType) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Projection "${input.projectionName}" not found`,
        });
      }
      return result;
    }),
});
