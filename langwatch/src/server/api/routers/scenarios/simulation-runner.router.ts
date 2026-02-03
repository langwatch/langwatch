import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  generateBatchRunId,
  SimulationRunnerService,
} from "~/server/scenarios/simulation-runner.service";
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
   * Returns immediately with setId for redirect; execution is async.
   */
  run: protectedProcedure
    .input(runScenarioSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      logger.debug(
        {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          targetType: input.target.type,
          targetReferenceId: input.target.referenceId,
        },
        "scenarios.run mutation called",
      );

      const setId = "local-scenarios";
      const batchRunId = generateBatchRunId();

      logger.info(
        { setId, batchRunId, scenarioId: input.scenarioId },
        "Generated batchRunId for scenario run",
      );

      const runnerService = SimulationRunnerService.create(ctx.prisma);

      // Fire and forget - execution happens async
      void runnerService.execute({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        target: input.target,
        setId,
        batchRunId,
      });

      logger.info({ setId, batchRunId }, "Returning from run mutation");

      return { setId, batchRunId };
    }),
});
