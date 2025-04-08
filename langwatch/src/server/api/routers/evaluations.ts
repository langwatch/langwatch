import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { evaluatorsSchema } from "../../evaluations/evaluators.zod.generated";
import { runEvaluationForTrace } from "../../background/workers/evaluationsWorker";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../evaluations/evaluators.generated";
import { prisma } from "~/server/db";
import { mappingStateSchema } from "../../tracer/tracesMapping";

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
      const customEvaluators = await getCustomEvaluators({
        projectId: input.projectId,
      });
      return customEvaluators;
    }),
  runEvaluation: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        evaluatorType: z.union([
          evaluatorsSchema.keyof(),
          z.string().refine((val) => val.startsWith("custom/")),
        ]),
        traceId: z.string(),
        settings: z.object({}).passthrough(),
        mappings: mappingStateSchema,
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.GUARDRAILS_MANAGE))
    .mutation(async ({ input }) => {
      const result = await runEvaluationForTrace({
        projectId: input.projectId,
        traceId: input.traceId,
        evaluatorType: input.evaluatorType as EvaluatorTypes,
        settings: input.settings,
        mappings: input.mappings ?? {},
      });

      return result;
    }),
});

export const getCustomEvaluators = async ({
  projectId,
}: {
  projectId: string;
}) => {
  const workflows = await prisma.workflow.findMany({
    where: {
      projectId,
      isEvaluator: true,
    },
    include: {
      versions: true,
    },
  });

  return workflows.map((workflow) => ({
    ...workflow,
    versions: workflow.versions.filter(
      (version) => version.id === workflow.publishedId
    ),
  }));
};
