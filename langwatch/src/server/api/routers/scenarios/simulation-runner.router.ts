/**
 * Router for running scenarios against targets.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { prefetchScenarioData } from "~/server/scenarios/execution/data-prefetcher";
import { SCENARIO_DEFAULTS } from "~/server/scenarios/scenario.constants";
import {
  generateBatchRunId,
  scheduleScenarioRun,
} from "~/server/scenarios/scenario.queue";
import { createLogger } from "~/utils/logger";
import { checkProjectPermission } from "../../rbac";
import { projectSchema } from "./schemas";

const logger = createLogger("SimulationRunnerRouter");

/**
 * Target for scenario simulation.
 * Extensible: add new types as needed (llm, workflow, etc.)
 */
export const simulationTargetSchema = z.object({
  type: z.enum(["prompt", "http"]),
  referenceId: z.string(),
});

export type SimulationTarget = z.infer<typeof simulationTargetSchema>;

const runScenarioSchema = projectSchema.extend({
  scenarioId: z.string(),
  target: simulationTargetSchema,
});

/**
 * Simulation runner - executing scenarios against targets.
 */
export const simulationRunnerRouter = createTRPCRouter({
  /**
   * Run a scenario against a target.
   *
   * Schedules the scenario for async execution and returns immediately
   * with the batch run ID for tracking. Does NOT return success/failure
   * of scenario execution - that happens asynchronously.
   */
  run: protectedProcedure
    .input(runScenarioSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ input }) => {
      const setId = SCENARIO_DEFAULTS.SET_ID;
      const batchRunId = generateBatchRunId();

      // Validate early - prefetch data to catch configuration errors before scheduling
      const prefetchResult = await prefetchScenarioData(
        { projectId: input.projectId, scenarioId: input.scenarioId, setId, batchRunId },
        input.target,
      );

      if (!prefetchResult.success) {
        logger.warn(
          { projectId: input.projectId, scenarioId: input.scenarioId, error: prefetchResult.error },
          "Scenario validation failed",
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: prefetchResult.error,
        });
      }

      logger.info(
        { projectId: input.projectId, scenarioId: input.scenarioId, batchRunId },
        "Scheduling scenario execution",
      );

      const job = await scheduleScenarioRun({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        target: input.target,
        setId,
        batchRunId,
      });

      logger.info(
        { jobId: job.id, batchRunId },
        "Scenario scheduled",
      );

      // Return honest response: job was scheduled, not executed
      return {
        scheduled: true,
        jobId: job.id,
        setId,
        batchRunId,
      };
    }),
});
