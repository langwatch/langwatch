import { TRPCError } from "@trpc/server";
import { on } from "node:events";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { getApp } from "~/server/app-layer/app";
import { SimulationService } from "~/server/simulations/simulation.service";
import { ScenarioJobRepository } from "~/server/scenarios/scenario-job.repository";
import { mergeRunData } from "~/server/scenarios/scenario-run.utils";
import { scenarioQueue } from "~/server/scenarios/scenario.queue";
import { isSuiteSetId } from "~/server/suites/suite-set-id";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { createLogger } from "~/utils/logger/server";
import { checkProjectPermission } from "../../rbac";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

const logger = createLogger("langwatch:api:scenarios:events");

// Base schema for all project-related operations
const projectSchema = z.object({
  projectId: z.string(),
});

const dateRangeFields = {
  startDate: z.number().int().nonnegative().optional(),
  endDate: z.number().int().nonnegative().optional(),
} as const;

/**
 * Unified helper that fetches suite run data for either a single suite
 * (when scenarioSetId is provided) or all suites (when absent).
 *
 * On the first page (no cursor), merges BullMQ queued/active jobs so
 * pending runs appear immediately before ES/ClickHouse indexes them.
 */
async function fetchSuiteRunData({
  projectId,
  scenarioSetId,
  limit,
  cursor,
  startDate,
  endDate,
  prisma,
}: {
  projectId: string;
  scenarioSetId?: string;
  limit: number;
  cursor?: string;
  startDate?: number;
  endDate?: number;
  prisma: PrismaClient;
}): Promise<{
  runs: ScenarioRunData[];
  scenarioSetIds: Record<string, string>;
  hasMore: boolean;
  nextCursor?: string;
}> {
  const service = SimulationService.create(prisma);

  let runs: ScenarioRunData[];
  let scenarioSetIds: Record<string, string>;
  let hasMore: boolean;
  let nextCursor: string | undefined;

  if (scenarioSetId) {
    // Single suite/set view
    const data = await service.getRunDataForScenarioSet({
      projectId,
      scenarioSetId,
      limit,
      cursor,
      startDate,
      endDate,
    });
    runs = data.runs;
    hasMore = data.hasMore;
    nextCursor = data.nextCursor;

    // Build scenarioSetIds map from the runs
    scenarioSetIds = {};
    for (const run of runs) {
      if (run.batchRunId) {
        scenarioSetIds[run.batchRunId] = scenarioSetId;
      }
    }
  } else {
    // Cross-suite view
    const data = await service.getRunDataForAllSuites({
      projectId,
      limit,
      cursor,
      startDate,
      endDate,
    });
    runs = data.runs;
    scenarioSetIds = data.scenarioSetIds;
    hasMore = data.hasMore;
    nextCursor = data.nextCursor;
  }

  // Merge BullMQ queued/active jobs on first page only
  if (!cursor) {
    try {
      const jobRepo = new ScenarioJobRepository(scenarioQueue);

      if (scenarioSetId && isSuiteSetId(scenarioSetId)) {
        const queuedRuns = await jobRepo.getQueuedAndActiveJobs({
          setId: scenarioSetId,
          projectId,
        });
        if (queuedRuns.length > 0) {
          runs = mergeRunData({ esRuns: runs, queuedRuns });
        }
      } else if (!scenarioSetId) {
        const queued = await jobRepo.getAllQueuedJobsForProject({ projectId });
        if (queued.runs.length > 0) {
          runs = mergeRunData({ esRuns: runs, queuedRuns: queued.runs });
          scenarioSetIds = { ...scenarioSetIds, ...queued.scenarioSetIds };
        }
      }
    } catch (error) {
      logger.warn(
        { projectId, scenarioSetId, error },
        "Failed to fetch BullMQ queued/active jobs; returning stored runs only",
      );
    }
  }

  return { runs, scenarioSetIds, hasMore, nextCursor };
}

export const scenarioEventsRouter = createTRPCRouter({
  // Get scenario sets data for a project
  getScenarioSetsData: protectedProcedure
    .input(projectSchema.extend(dateRangeFields))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId }, "Fetching scenario sets data");
      const service = SimulationService.create(ctx.prisma);
      return service.getScenarioSetsDataForProject({
        projectId: input.projectId,
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }),

  // Unified endpoint: fetches suite run data for a single suite or all suites
  getSuiteRunData: protectedProcedure
    .input(
      projectSchema
        .extend({
          scenarioSetId: z.string().optional(),
          limit: z.number().min(1).max(100).default(20),
          cursor: z.string().optional(),
        })
        .extend(dateRangeFields),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId, limit: input.limit, hasCursor: !!input.cursor },
        "Fetching suite run data (unified)",
      );
      return fetchSuiteRunData({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        limit: input.limit,
        cursor: input.cursor,
        startDate: input.startDate,
        endDate: input.endDate,
        prisma: ctx.prisma,
      });
    }),

  // Get all run data for a scenario set (paginated, no BullMQ merge)
  getScenarioSetRunData: protectedProcedure
    .input(
      projectSchema
        .extend({
          scenarioSetId: z.string(),
          limit: z.number().min(1).max(100).default(20),
          cursor: z.string().optional(),
        })
        .extend(dateRangeFields),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId, limit: input.limit, hasCursor: !!input.cursor },
        "Fetching scenario set run data",
      );
      const service = SimulationService.create(ctx.prisma);
      const data = await service.getRunDataForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        limit: input.limit,
        cursor: input.cursor,
        startDate: input.startDate,
        endDate: input.endDate,
      });
      return data;
    }),

  /**
   * @deprecated Use getSuiteRunData instead. Kept for backward compatibility.
   */
  getAllScenarioSetRunData: protectedProcedure
    .input(projectSchema.extend({ scenarioSetId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId, scenarioSetId: input.scenarioSetId }, "Fetching all scenario set run data (deprecated)");
      const result = await fetchSuiteRunData({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        limit: 100,
        prisma: ctx.prisma,
      });
      return result.runs;
    }),

  // Get scenario run state
  getRunState: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioRunId: z.string(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId, scenarioRunId: input.scenarioRunId }, "Fetching scenario run state");
      const service = SimulationService.create(ctx.prisma);
      const data = await service.getScenarioRunData({
        projectId: input.projectId,
        scenarioRunId: input.scenarioRunId,
      });

      if (!data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scenario run not found",
        });
      }
      return data;
    }),

  // Get total count of batch runs for a scenario set (for pagination)
  getScenarioSetBatchRunCount: protectedProcedure
    .input(projectSchema.extend({ scenarioSetId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId, scenarioSetId: input.scenarioSetId }, "Fetching batch run count");
      const service = SimulationService.create(ctx.prisma);
      const count = await service.getBatchRunCountForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
      });
      return { count };
    }),

  // Get scenario run data by scenario id
  getRunDataByScenarioId: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioId: z.string(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId, scenarioId: input.scenarioId }, "Fetching run data by scenario id");
      const service = SimulationService.create(ctx.prisma);
      const data = await service.getScenarioRunDataByScenarioId({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
      });
      return { data };
    }),

  // Get pre-aggregated batch history for the sidebar (no full messages)
  getScenarioSetBatchHistory: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioSetId: z.string(),
        limit: z.number().min(1).max(100).default(8),
        cursor: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId, limit: input.limit },
        "Fetching scenario set batch history",
      );
      const service = SimulationService.create(ctx.prisma);
      return service.getBatchHistoryForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        limit: input.limit,
        cursor: input.cursor,
      });
    }),

  // Get scenario run data for a specific batch run (conditional: skip if unchanged)
  getBatchRunData: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioSetId: z.string(),
        batchRunId: z.string(),
        sinceTimestamp: z.number().optional(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId, batchRunId: input.batchRunId },
        "Fetching batch run data",
      );
      const service = SimulationService.create(ctx.prisma);
      return service.getRunDataForBatchRun({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        batchRunId: input.batchRunId,
        sinceTimestamp: input.sinceTimestamp,
      });
    }),

  // Get summaries for external (SDK/CI) scenario sets
  getExternalSetSummaries: protectedProcedure
    .input(projectSchema.extend(dateRangeFields))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId }, "Fetching external set summaries");
      const service = SimulationService.create(ctx.prisma);
      return service.getExternalSetSummaries({
        projectId: input.projectId,
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }),

  /**
   * @deprecated Use getSuiteRunData (without scenarioSetId) instead. Kept for backward compatibility.
   */
  getAllSuiteRunData: protectedProcedure
    .input(
      projectSchema
        .extend({
          limit: z.number().min(1).max(100).default(20),
          cursor: z.string().optional(),
        })
        .extend(dateRangeFields),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId, limit: input.limit, hasCursor: !!input.cursor }, "Fetching all suite run data");
      const service = SimulationService.create(ctx.prisma);
      const data = await service.getRunDataForAllSuites({
        projectId: input.projectId,
        limit: input.limit,
        cursor: input.cursor,
        startDate: input.startDate,
        endDate: input.endDate,
      });

      // Merge BullMQ queued/active jobs on the first page only
      // (subsequent pages are historical and won't have queued jobs)
      if (!input.cursor) {
        try {
          const jobRepo = new ScenarioJobRepository(scenarioQueue);
          const queued = await jobRepo.getAllQueuedJobsForProject({
            projectId: input.projectId,
          });

          if (queued.runs.length > 0) {
            data.runs = mergeRunData({ esRuns: data.runs, queuedRuns: queued.runs });
            data.scenarioSetIds = { ...data.scenarioSetIds, ...queued.scenarioSetIds };
          }
        } catch (error) {
          logger.warn(
            { projectId: input.projectId, error },
            "Failed to fetch BullMQ queued/active jobs for all suites; returning ES runs only",
          );
        }
      }

      return data;
    }),

  onSimulationUpdate: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .subscription(async function* (opts) {
      const { projectId } = opts.input;
      const emitter = getApp().broadcast.getTenantEmitter(projectId);

      logger.info({ projectId }, "Simulation SSE subscription started");

      for await (const eventArgs of on(emitter, "simulation_updated", {
        // @ts-expect-error - signal is not typed
        signal: opts.signal,
      })) {
        logger.debug(
          { projectId, event: eventArgs[0] },
          "Simulation SSE event received",
        );
        yield eventArgs[0];
      }
    }),
});
