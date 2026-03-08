import { TRPCError } from "@trpc/server";
import { on } from "node:events";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { SimulationFacade } from "~/server/simulations/simulation.facade";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { createLogger } from "~/utils/logger/server";
import { checkProjectPermission } from "../../rbac";
import type { BatchRunDataResult, ScenarioRunData } from "~/server/scenarios/scenario-event.types";

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
 * Returns data from ES/ClickHouse. Pending items are visible immediately
 * because SuiteRunService dispatches simulation startRun commands at
 * scheduling time (before BullMQ jobs begin processing).
 *
 * Real-time updates are delivered via SSE (onSimulationUpdate subscription).
 */
async function fetchSuiteRunData({
  projectId,
  scenarioSetId,
  limit,
  cursor,
  startDate,
  endDate,
  sinceTimestamp,
}: {
  projectId: string;
  scenarioSetId?: string;
  limit: number;
  cursor?: string;
  startDate?: number;
  endDate?: number;
  sinceTimestamp?: number;
}) {
  const service = SimulationFacade.create();

  if (scenarioSetId) {
    // Single suite/set view — no conditional fetch support yet
    const data = await service.getRunDataForScenarioSet({
      projectId,
      scenarioSetId,
      limit,
      cursor,
      startDate,
      endDate,
    });

    const scenarioSetIds: Record<string, string> = {};
    for (const run of data.runs) {
      if (run.batchRunId) {
        scenarioSetIds[run.batchRunId] = scenarioSetId;
      }
    }

    return { changed: true as const, lastUpdatedAt: 0, runs: data.runs, scenarioSetIds, hasMore: data.hasMore, nextCursor: data.nextCursor };
  }

  // Cross-suite view — supports conditional fetch via sinceTimestamp
  return service.getRunDataForAllSuites({
    projectId,
    limit,
    cursor,
    startDate,
    endDate,
    sinceTimestamp,
  });
}

export const scenarioEventsRouter = createTRPCRouter({
  // Get scenario sets data for a project
  getScenarioSetsData: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId }, "Fetching scenario sets data");
      const service = SimulationFacade.create();
      const data = await service.getScenarioSetsDataForProject({
        projectId: input.projectId,
      });
      return data;
    }),

  // Unified endpoint: fetches suite run data for a single suite or all suites
  getSuiteRunData: protectedProcedure
    .input(
      projectSchema
        .extend({
          scenarioSetId: z.string().optional(),
          limit: z.number().min(1).max(100).default(20),
          cursor: z.string().optional(),
          sinceTimestamp: z.number().optional(),
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
        sinceTimestamp: input.sinceTimestamp,
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
      const service = SimulationFacade.create();
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
      });
      return result.changed ? result.runs : [];
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
      const service = SimulationFacade.create();
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
      const service = SimulationFacade.create();
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
      const service = SimulationFacade.create();
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
      const service = SimulationFacade.create();
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
      const service = SimulationFacade.create();
      return service.getRunDataForBatchRun({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        batchRunId: input.batchRunId,
        sinceTimestamp: input.sinceTimestamp,
      });
    }),

  // Get summaries for external (SDK/CI) scenario sets
  getExternalSetSummaries: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId }, "Fetching external set summaries");
      const service = SimulationFacade.create();
      return service.getExternalSetSummaries({
        projectId: input.projectId,
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
      const service = SimulationFacade.create();
      return service.getRunDataForAllSuites({
        projectId: input.projectId,
        limit: input.limit,
        cursor: input.cursor,
        startDate: input.startDate,
        endDate: input.endDate,
      });
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
