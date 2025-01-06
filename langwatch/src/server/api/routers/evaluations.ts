import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { evaluatorsSchema } from "../../evaluations/evaluators.zod.generated";
import { runEvaluationForTrace } from "../../background/workers/evaluationsWorker";
import { AVAILABLE_EVALUATORS } from "../../evaluations/evaluators.generated";
import { prisma } from "~/server/db";

export const evaluationsRouter = createTRPCRouter({
  availableEvaluators: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_MANAGE))
    .query(async () => {
      return Object.fromEntries(
        Object.entries(AVAILABLE_EVALUATORS).map(([key, evaluator]) => [
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

  availableCustomEvaluators: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_VIEW))
    .query(async ({ input }) => {
      const customEvaluators = await prisma.workflow
        .findMany({
          where: {
            projectId: input.projectId,
            isEvaluator: true,
          },
          include: {
            versions: true, // Include all versions initially
          },
        })
        .then((workflows) =>
          workflows.map((workflow) => ({
            ...workflow,
            versions: workflow.versions.filter(
              (version) => version.id === workflow.publishedId
            ), // Filter manually
          }))
        );
      return customEvaluators;
    }),
  runEvaluation: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        evaluatorType: evaluatorsSchema.keyof(),
        traceId: z.string(),
        settings: z.object({}).passthrough(),
        mappings: z.record(z.string(), z.string()).optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_MANAGE))
    .mutation(async ({ input }) => {
      const result = await runEvaluationForTrace({
        projectId: input.projectId,
        traceId: input.traceId,
        evaluatorType: input.evaluatorType,
        settings: input.settings,
        mappings: input.mappings ?? {},
      });

      return result;
    }),
});
