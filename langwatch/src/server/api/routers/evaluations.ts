import { z } from "zod";
import { prisma } from "~/server/db";
import { runEvaluationForTrace } from "../../background/workers/evaluationsWorker";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../evaluations/evaluators.zod.generated";
import { mappingStateSchema } from "../../tracer/tracesMapping";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { getUserProtectionsForProject } from "../utils";

export const evaluationsRouter = createTRPCRouter({
  availableEvaluators: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async () => {
      return Object.fromEntries(
        Object.entries(AVAILABLE_EVALUATORS).map(([key, evaluator]) => [
          key,
          {
            ...evaluator,
            missingEnvVars: evaluator.envVars.filter(
              (envVar) => !process.env[envVar],
            ),
          },
        ]),
      );
    }),

  availableCustomEvaluators: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
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
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const result = await runEvaluationForTrace({
        projectId: input.projectId,
        traceId: input.traceId,
        evaluatorType: input.evaluatorType as EvaluatorTypes,
        settings: input.settings,
        mappings: input.mappings ?? {},
        protections,
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
      (version) => version.id === workflow.publishedId,
    ),
  }));
};
