import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { evaluatorsSchema } from "../../../trace_checks/evaluators.zod.generated";
import { runEvaluationForTrace } from "../../background/workers/traceChecksWorker";

export const evaluationsRouter = createTRPCRouter({
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
