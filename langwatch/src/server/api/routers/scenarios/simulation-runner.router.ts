/**
 * Router for running scenarios against targets.
 */

import { z } from "zod";
import { prisma } from "~/server/db";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  SimulationRunnerService,
  generateBatchRunId,
} from "~/server/scenarios/simulation-runner.service";
import { createLogger } from "~/utils/logger";
import { checkProjectPermission } from "../../rbac";
import { projectSchema } from "./schemas";

const logger = createLogger("SimulationRunnerRouter");

/** Default scenario set for on-platform runs */
const PLATFORM_SET_ID = "on-platform";

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
  /** Optional set ID - defaults to on-platform for ad-hoc runs */
  setId: z.string().optional(),
});

/**
 * Simulation runner - executing scenarios against targets.
 */
export const simulationRunnerRouter = createTRPCRouter({
  /**
   * Run a scenario against a target.
   *
   * Fires off scenario execution asynchronously and returns immediately
   * with the batch run ID for tracking.
   */
  run: protectedProcedure
    .input(runScenarioSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ input }) => {
      const setId = input.setId ?? PLATFORM_SET_ID;
      const batchRunId = generateBatchRunId();

      logger.info(
        { projectId: input.projectId, scenarioId: input.scenarioId, batchRunId },
        "Starting scenario execution",
      );

      // Fire and forget - execute in background
      const service = SimulationRunnerService.create(prisma);
      void service.execute({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        target: input.target,
        setId,
        batchRunId,
      });

      // Return immediately - execution happens async
      return {
        scheduled: true,
        setId,
        batchRunId,
      };
    }),
});
