import { generate } from "@langwatch/ksuid";
import { z } from "zod";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { KSUID_RESOURCES } from "~/utils/constants";
import { trackServerEvent } from "~/server/posthog";

import { createLogger } from "~/utils/logger/server";
import {
  AZURE_SAFETY_ENV_VARS,
  getAzureSafetyEnvFromProject,
  isAzureEvaluatorType,
} from "../../app-layer/evaluations/azure-safety-env";
import { runEvaluationForTrace } from "../../background/workers/evaluationsWorker";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../evaluations/evaluators.generated";
import { mappingStateSchema } from "../../tracer/tracesMapping";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { getUserProtectionsForProject } from "../utils";

const logger = createLogger("langwatch:evaluations");

export const evaluationsRouter = createTRPCRouter({
  availableEvaluators: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ input }) => {
      // Azure Safety evaluators are gated by the per-project azure_safety
      // Model Provider — we no longer read process.env for those. Compute
      // once and reuse for all three Azure evaluator types.
      const azureSafetyEnv = await getAzureSafetyEnvFromProject(
        input.projectId,
      );
      const azureMissingEnvVars = azureSafetyEnv
        ? []
        : [...AZURE_SAFETY_ENV_VARS];

      return Object.fromEntries(
        Object.entries(AVAILABLE_EVALUATORS).map(([key, evaluator]) => [
          key,
          {
            ...evaluator,
            missingEnvVars: isAzureEvaluatorType(key)
              ? azureMissingEnvVars
              : evaluator.envVars.filter((envVar) => !process.env[envVar]),
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

      // Dispatch to evaluation processing pipeline when flag is ON
      if (result) {
        trackServerEvent({
          userId: ctx.session.user.id,
          event: "evaluation_ran",
          projectId: input.projectId,
        });
      }

      // Dispatch to evaluation processing pipeline
      if (result) {
        const evaluationId = generate(KSUID_RESOURCES.EVALUATION).toString();
        try {
          const app = getApp();
          await app.evaluations.reportEvaluation({
            tenantId: input.projectId,
            evaluationId,
            evaluatorId: input.evaluatorType,
            evaluatorType: input.evaluatorType,
            traceId: input.traceId,
            status: result.status,
            score: result.status === "processed" && typeof result.score === 'number' ? result.score : undefined,
            passed: result.status === "processed" ? (result.passed ?? undefined) : undefined,
            label: result.status === "processed" ? (result.label ?? undefined) : undefined,
            details: result.status === "error" ? result.details : result.status === "processed" ? (result.details ?? undefined) : undefined,
            error: result.status === "error" ? result.details : undefined,
            occurredAt: Date.now(),
          });
        } catch (error) {
          logger.warn(
            { error, evaluationId, evaluatorType: input.evaluatorType },
            "Failed to dispatch single re-eval to evaluation processing pipeline",
          );
        }
      }

      return result;
    }),

  /**
   * Warm up Lambda instances for evaluations.
   * Sends multiple parallel health check requests to the backend to keep
   * Lambda instances warm, improving response times when running evaluations.
   *
   * @param count - Number of parallel warmup requests to send (half of concurrency, min 1)
   */
  warmupLambda: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        count: z.number().min(1).max(24).default(5),
      }),
    )
    .use(checkProjectPermission("evaluations:view"))
    .mutation(async ({ input }) => {
      const { projectId, count } = input;

      logger.debug({ projectId, count }, "Warming up Lambda instances");

      // Send parallel warmup requests
      const warmupPromises = Array.from({ length: count }, () =>
        studioBackendPostEvent({
          projectId,
          message: { type: "is_alive", payload: {} },
          onEvent: () => {
            // Response received - lambda is warm
          },
        }).catch((error) => {
          // Silently ignore errors - this is just warmup
          logger.debug({ error, projectId }, "Lambda warmup request failed");
        }),
      );

      await Promise.allSettled(warmupPromises);

      return { success: true, count };
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
