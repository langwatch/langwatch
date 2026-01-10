import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkProjectPermission } from "../../rbac";
import { SimulationRunnerService } from "~/server/scenarios/simulation-runner.service";
import { projectSchema } from "./schemas";

/**
 * Target for scenario simulation.
 * Extensible: add new types as needed (llm, http, workflow, etc.)
 */
export const simulationTargetSchema = z.object({
  type: z.enum(["prompt"]),
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
      const setId = "local-scenarios";

      const runnerService = SimulationRunnerService.create(ctx.prisma);

      // Fire and forget - execution happens async
      void runnerService.execute({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        target: input.target,
        setId,
      });

      return { setId };
    }),
});

