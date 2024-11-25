import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { evaluatorsSchema } from "../../evaluations/evaluators.zod.generated";
import { runEvaluationForTrace } from "../../background/workers/evaluationsWorker";
import { AVAILABLE_EVALUATORS } from "../../evaluations/evaluators.generated";

export const evaluationsRouter = createTRPCRouter({
  availableEvaluators: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_MANAGE))
    .query(async () => {
      return Object.fromEntries(
        Object.entries(AVAILABLE_EVALUATORS)
          .map(([key, evaluator]) => [
            key,
            {
              ...evaluator,
              missingEnvVars: evaluator.envVars.filter(
                (envVar) => !process.env[envVar]
              ),
            },
          ])
      );
    }),
  runEvaluation: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        evaluatorType: evaluatorsSchema.keyof(),
        traceId: z.string(),
        settings: z.object({}).passthrough(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_MANAGE))
    .mutation(async ({ input }) => {
      const result = await runEvaluationForTrace({
        projectId: input.projectId,
        traceId: input.traceId,
        evaluatorType: input.evaluatorType,
        settings: input.settings,
      });

      return result;
    }),
});
