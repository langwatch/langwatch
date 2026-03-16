/**
 * Stall detection for scenario executions.
 *
 * Periodically checks for simulation runs stuck in IN_PROGRESS status
 * for longer than the stall threshold and dispatches finishRun ERROR.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import type { SimulationResults } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/shared";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:scenarios:stall-detection");

/** Runs stuck longer than this are considered stalled */
const STALL_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** How often to check for stalled runs */
export const STALL_CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export interface StallDetectionDeps {
  clickhouse: ClickHouseClient;
  dispatchFinishRun: (data: {
    tenantId: string;
    scenarioRunId: string;
    status?: string;
    results?: SimulationResults;
    durationMs?: number;
    occurredAt: number;
  }) => Promise<void>;
}

interface StalledRun {
  TenantId: string;
  ScenarioRunId: string;
  UpdatedAt: string;
}

/**
 * Creates a stall detection sweep function.
 *
 * Queries ClickHouse for runs stuck in IN_PROGRESS status beyond the threshold
 * and dispatches finishRun ERROR for each.
 */
export function createStallDetectionSweep(deps: StallDetectionDeps) {
  return async function sweep(): Promise<void> {
    try {
      const thresholdMs = Date.now() - STALL_THRESHOLD_MS;
      const thresholdDate = new Date(thresholdMs)
        .toISOString()
        .replace("T", " ")
        .replace("Z", "");

      const result = await deps.clickhouse.query({
        query: `
          SELECT TenantId, ScenarioRunId, toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt
          FROM simulation_runs
          WHERE Status = 'IN_PROGRESS'
            AND UpdatedAt < toDateTime64({threshold:String}, 3)
          ORDER BY UpdatedAt ASC
          LIMIT 100
        `,
        query_params: { threshold: thresholdDate },
        format: "JSONEachRow",
        clickhouse_settings: { select_sequential_consistency: "1" },
      });

      const stalledRuns = await result.json<StalledRun>();

      if (stalledRuns.length === 0) return;

      logger.warn(
        { count: stalledRuns.length },
        "Found stalled simulation runs, dispatching ERROR",
      );

      await Promise.allSettled(
        stalledRuns.map(async (run) => {
          try {
            await deps.dispatchFinishRun({
              tenantId: run.TenantId,
              scenarioRunId: run.ScenarioRunId,
              status: "ERROR",
              results: {
                verdict: "failure",
                reasoning: "Execution stalled — no progress detected for over 10 minutes",
                metCriteria: [],
                unmetCriteria: [],
                error: "Execution stalled",
              },
              occurredAt: Date.now(),
            });

            logger.info(
              {
                tenantId: run.TenantId,
                scenarioRunId: run.ScenarioRunId,
              },
              "Dispatched finishRun ERROR for stalled run",
            );
          } catch (error) {
            logger.error(
              {
                tenantId: run.TenantId,
                scenarioRunId: run.ScenarioRunId,
                error: error instanceof Error ? error.message : String(error),
              },
              "Failed to dispatch finishRun for stalled run",
            );
          }
        }),
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Stall detection sweep failed",
      );
    }
  };
}

/**
 * Starts periodic stall detection.
 * Returns a cleanup function to stop the interval.
 */
export function startStallDetection(deps: StallDetectionDeps): {
  close: () => void;
} {
  const sweep = createStallDetectionSweep(deps);
  const interval = setInterval(() => void sweep(), STALL_CHECK_INTERVAL_MS);

  // Run immediately on startup
  void sweep();

  logger.info(
    { intervalMs: STALL_CHECK_INTERVAL_MS, thresholdMs: STALL_THRESHOLD_MS },
    "Stall detection started",
  );

  return {
    close: () => {
      clearInterval(interval);
      logger.info("Stall detection stopped");
    },
  };
}
