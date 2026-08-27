import { on } from "node:events";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import type { SimulationBatchRunData, SimulationService } from "@langwatch/simulation-contract";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { startScenarioTabPresence } from "@langwatch/scenario-contract";

const logger = createLogger("langwatch:api:scenarios:events");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Resolves optional input dates to concrete values (defaults to last 30 days). */
function resolveDateRange(input: { startDate?: number; endDate?: number }): {
  startDate: number;
  endDate: number;
} {
  return {
    startDate: input.startDate ?? Date.now() - THIRTY_DAYS_MS,
    endDate: input.endDate ?? Date.now(),
  };
}

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
 * Returns data from ClickHouse. Pending items are visible immediately
 * because Suite execution dispatches simulation startRun commands at
 * scheduling time (before queued jobs begin processing).
 *
 * Real-time updates are delivered via SSE (onSimulationUpdate subscription).
 */
async function fetchSuiteRunData({
  simulations,
  projectId,
  scenarioSetId,
  limit,
  cursor,
  startDate,
  endDate,
  sinceTimestamp,
}: {
  simulations: SimulationService;
  projectId: string;
  scenarioSetId?: string;
  limit: number;
  cursor?: string;
  startDate?: number;
  endDate?: number;
  sinceTimestamp?: number;
}) {
  if (scenarioSetId) {
    // Single suite/set view — no conditional fetch support yet
    const data = await simulations.getRunDataForScenarioSet({
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

    return {
      changed: true as const,
      lastUpdatedAt: 0,
      runs: data.runs,
      scenarioSetIds,
      hasMore: data.hasMore,
      nextCursor: data.nextCursor,
    };
  }

  // Cross-suite view — supports conditional fetch via sinceTimestamp
  return simulations.getRunDataForAllSuites({
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
    .input(projectSchema.extend(dateRangeFields))
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId }, "Fetching scenario sets data");
      const dates = resolveDateRange(input);
      return ctx.app.simulations.getScenarioSetsData({
        projectId: input.projectId,
        ...dates,
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
          sinceTimestamp: z.number().optional(),
        })
        .extend(dateRangeFields),
    )
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      logger.debug(
        {
          projectId: input.projectId,
          scenarioSetId: input.scenarioSetId,
          limit: input.limit,
          hasCursor: !!input.cursor,
        },
        "Fetching suite run data (unified)",
      );
      const dates = resolveDateRange(input);
      return fetchSuiteRunData({
        simulations: ctx.app.simulations,
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        limit: input.limit,
        cursor: input.cursor,
        ...dates,
        sinceTimestamp: input.sinceTimestamp,
      });
    }),

  // The latest run result per test case inside the window, for the
  // last-result cells of the cases table. Separate from the case list read on
  // purpose: the list renders instantly and these cells stream in.
  getLastResultSummaries: protectedProcedure
    .input(
      projectSchema
        .extend({
          scenarioIds: z.array(z.string()).optional(),
        })
        .extend(dateRangeFields),
    )
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      const dates = resolveDateRange(input);
      return ctx.app.simulations.getLastResultSummaries({
        projectId: input.projectId,
        scenarioIds: input.scenarioIds,
        ...dates,
      });
    }),

  // Cheap freshness probe for the run history views: returns only the latest
  // UpdatedAt across the project's runs in the window. Clients poll this tiny
  // response and invalidate getSuiteRunData only when the value advances,
  // instead of re-downloading run payloads on a timer.
  getSuiteRunFreshness: protectedProcedure
    .input(projectSchema.extend({ scenarioSetId: z.string().optional() }).extend(dateRangeFields))
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      const dates = resolveDateRange(input);
      const lastUpdatedAt = await ctx.app.simulations.getLastUpdatedAt({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        ...dates,
      });
      return { lastUpdatedAt };
    }),

  // Get all run data for a scenario set (paginated, no queued-job merge)
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
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      logger.debug(
        {
          projectId: input.projectId,
          scenarioSetId: input.scenarioSetId,
          limit: input.limit,
          hasCursor: !!input.cursor,
        },
        "Fetching scenario set run data",
      );
      const dates = resolveDateRange(input);
      const data = await ctx.app.simulations.getRunDataForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        limit: input.limit,
        cursor: input.cursor,
        ...dates,
      });
      return data;
    }),

  /**
   * @deprecated Use getSuiteRunData instead. Kept for backward compatibility.
   */
  getAllScenarioSetRunData: protectedProcedure
    .input(projectSchema.extend({ scenarioSetId: z.string() }).extend(dateRangeFields))
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      logger.debug(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId },
        "Fetching all scenario set run data (deprecated)",
      );
      const dates = resolveDateRange(input);
      const result = await fetchSuiteRunData({
        simulations: ctx.app.simulations,
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        limit: 100,
        ...dates,
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
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      logger.debug(
        { projectId: input.projectId, scenarioRunId: input.scenarioRunId },
        "Fetching scenario run state",
      );
      // Point lookup by unique run id — no date window, so runs older than any
      // default range stay reachable.
      const data = await ctx.app.simulations.tryGetScenarioRunData({
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
    .input(projectSchema.extend({ scenarioSetId: z.string() }).extend(dateRangeFields))
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      logger.debug(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId },
        "Fetching batch run count",
      );
      const dates = resolveDateRange(input);
      const count = await ctx.app.simulations.getBatchRunCountForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        ...dates,
      });
      return { count };
    }),

  // Get pre-aggregated batch history for the sidebar (no full messages)
  getScenarioSetBatchHistory: protectedProcedure
    .input(
      projectSchema
        .extend({
          scenarioSetId: z.string(),
          limit: z.number().min(1).max(100).default(8),
          cursor: z.string().optional(),
        })
        .extend(dateRangeFields),
    )
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      logger.debug(
        {
          projectId: input.projectId,
          scenarioSetId: input.scenarioSetId,
          limit: input.limit,
        },
        "Fetching scenario set batch history",
      );
      const dates = resolveDateRange(input);
      return ctx.app.simulations.getBatchHistoryForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        limit: input.limit,
        cursor: input.cursor,
        ...dates,
      });
    }),

  // Get scenario run data for a specific batch run (conditional: skip if unchanged)
  getBatchRunData: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioSetId: z.string(),
        batchRunId: z.string(),
        sinceTimestamp: z.number().optional(),
        runTimestamps: z.record(z.string(), z.number()).optional(),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      logger.debug(
        {
          projectId: input.projectId,
          scenarioSetId: input.scenarioSetId,
          batchRunId: input.batchRunId,
        },
        "Fetching batch run data",
      );
      // Point lookup by batch run id — no date window, so old batches stay
      // reachable when opened directly.
      const result = await ctx.app.simulations.getRunDataForBatchRun({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        batchRunId: input.batchRunId,
        sinceTimestamp: input.sinceTimestamp,
      });
      return filterRunsByTimestamp(result, input.runTimestamps);
    }),

  // Get summaries for external (SDK/CI) scenario sets
  getExternalSetSummaries: protectedProcedure
    .input(projectSchema.extend(dateRangeFields))
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId }, "Fetching external set summaries");
      const dates = resolveDateRange(input);
      return ctx.app.simulations.getExternalSetSummaries({
        projectId: input.projectId,
        ...dates,
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
    .permission("scenarios:view")
    .query(async ({ input, ctx }) => {
      logger.debug(
        {
          projectId: input.projectId,
          limit: input.limit,
          hasCursor: !!input.cursor,
        },
        "Fetching all suite run data",
      );
      const dates = resolveDateRange(input);
      return ctx.app.simulations.getRunDataForAllSuites({
        projectId: input.projectId,
        limit: input.limit,
        cursor: input.cursor,
        ...dates,
      });
    }),

  onSimulationUpdate: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        // Present only on a tab the SDK opened. While the subscription lives,
        // that tab is offered runs started on the same machine instead of the
        // SDK opening yet another browser tab.
        tabKey: z.string().min(1).max(200).optional(),
        tabId: z.string().min(1).max(200).optional(),
      }),
    )
    .permission("scenarios:view")
    .subscription(async function* (opts) {
      const { projectId, tabKey, tabId } = opts.input;
      const emitter = opts.ctx.app.broadcast.getTenantEmitter(projectId);

      logger.info({ projectId }, "Simulation SSE subscription started");

      const presence =
        tabKey && tabId
          ? await startScenarioTabPresence({
              registration: { projectId, tabKey, tabId },
              registry: opts.ctx.app.scenarioTabs,
            })
          : null;

      if (presence?.parkedNavigate) {
        // Same envelope the broadcast path emits, so the client has one shape
        // to parse.
        yield {
          event: JSON.stringify(presence.parkedNavigate),
          timestamp: Date.now(),
        };
      }

      // tRPC v10 callers leave `opts.signal` undefined, so the request's own
      // signal rides in on the context. Without it a disconnected client keeps
      // this generator suspended, its emitter listener attached, and its tab
      // registered forever.
      const signal = opts.ctx.signal ?? (opts.signal as AbortSignal | undefined);

      try {
        for await (const eventArgs of on(emitter, "simulation_updated", {
          signal,
        })) {
          logger.debug({ projectId, event: eventArgs[0] }, "Simulation SSE event received");
          yield eventArgs[0];
        }
      } catch (error) {
        // A disconnect aborts the wait; that is the normal end of a
        // subscription, not something to surface as a stream error.
        if ((error as { name?: string })?.name !== "AbortError") throw error;
      } finally {
        await presence?.stop();
      }
    }),
});

/**
 * Filter runs by per-run timestamps so only changed runs are returned.
 * When `runTimestamps` is absent, returns the result unchanged (backward compatible).
 */
export function filterRunsByTimestamp(
  result: SimulationBatchRunData,
  runTimestamps?: Record<string, number>,
): SimulationBatchRunData {
  if (!result.changed || !runTimestamps) return result;

  const filtered = result.runs.filter((run) => {
    const clientTs = runTimestamps[run.scenarioRunId];
    // Include new runs (not in client map) or runs updated since client's last fetch
    const runUpdatedAt = run.updatedAt ?? run.timestamp;
    return clientTs === undefined || runUpdatedAt > clientTs;
  });

  if (filtered.length === 0) {
    return { changed: false as const, lastUpdatedAt: result.lastUpdatedAt };
  }

  return {
    changed: true as const,
    lastUpdatedAt: result.lastUpdatedAt,
    runs: filtered,
  };
}
