import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkProjectPermission } from "../../rbac";

const projectSchema = z.object({
  projectId: z.string(),
});

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
    .mutation(async ({ input }) => {
      const setId = "local-scenarios";

      // TODO: Wire up ScenarioRunnerService with adapter based on target.type
      // const adapter = resolveAdapter(input.target);
      // void runnerService.execute({ scenarioId: input.scenarioId, adapter, setId });

      return { setId };
    }),
});

