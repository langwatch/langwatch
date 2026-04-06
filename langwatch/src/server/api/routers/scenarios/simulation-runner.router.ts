/**
 * Router for running scenarios against targets.
 */

import { TRPCError } from "@trpc/server";
import { generate } from "@langwatch/ksuid";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  createDataPrefetcherDependencies,
  prefetchScenarioData,
} from "~/server/scenarios/execution/data-prefetcher";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import {
  generateBatchRunId,
  scheduleScenarioRun,
} from "~/server/scenarios/scenario.queue";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createLogger } from "~/utils/logger/server";
import { checkProjectPermission } from "../../rbac";
import { projectSchema } from "./schemas";

const logger = createLogger("SimulationRunnerRouter");

/**
 * Target for scenario simulation.
 * Extensible: add new types as needed (llm, workflow, etc.)
 */
export const simulationTargetSchema = z.object({
  type: z.enum(["prompt", "http", "code"]),
  referenceId: z.string(),
});

export type SimulationTarget = z.infer<typeof simulationTargetSchema>;

const runScenarioSchema = projectSchema.extend({
  scenarioId: z.string(),
  target: simulationTargetSchema,
  /** Optional set ID - defaults to internal on-platform set ID for ad-hoc runs */
  setId: z.string().optional(),
  /** Optional client-generated batch run ID for immediate placeholder feedback */
  batchRunId: z.string().optional(),
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
      const setId = input.setId ?? getOnPlatformSetId(input.projectId);
      const batchRunId = input.batchRunId ?? generateBatchRunId();

      // Validate early - prefetch data to catch configuration errors before scheduling
      const deps = createDataPrefetcherDependencies();
      const prefetchResult = await prefetchScenarioData(
        {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          setId,
          batchRunId,
        },
        input.target,
        deps,
      );

      if (!prefetchResult.success) {
        logger.warn(
          {
            projectId: input.projectId,
            scenarioId: input.scenarioId,
            error: prefetchResult.error,
          },
          "Scenario validation failed",
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: prefetchResult.error,
        });
      }

      const scenarioRunId = generate(KSUID_RESOURCES.SCENARIO_RUN).toString();

      logger.info(
        {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          batchRunId,
          scenarioRunId,
        },
        "Scheduling scenario execution",
      );

      // Dispatch queueRun command first so QUEUED state is written to ClickHouse
      // before the BullMQ job is scheduled — same pattern as SuiteRunService.startRun()
      try {
        await getApp().simulations.queueRun({
          tenantId: input.projectId,
          scenarioRunId,
          scenarioId: input.scenarioId,
          batchRunId,
          scenarioSetId: setId,
          target: { type: input.target.type, referenceId: input.target.referenceId },
          occurredAt: Date.now(),
        });
      } catch (error) {
        logger.error(
          { error, projectId: input.projectId, scenarioRunId, batchRunId },
          "Failed to queue scenario run",
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to queue scenario run",
          cause: error,
        });
      }

      const job = await scheduleScenarioRun({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        target: input.target,
        setId,
        batchRunId,
        scenarioRunId,
        index: 0,
      });

      logger.info({ jobId: job.id, batchRunId, scenarioRunId }, "Scenario scheduled");

      // Return honest response: job was scheduled, not executed
      return {
        scheduled: true,
        jobId: job.id,
        setId,
        batchRunId,
        scenarioRunId,
      };
    }),
});
