import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import { prisma } from "~/server/db";
import { trackServerEvent } from "~/server/posthog";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  AZURE_SAFETY_ENV_VARS,
  isAzureEvaluatorType,
} from "@langwatch/evaluation-contract";
import { getAzureSafetyEnvFromProject } from "../../app-layer/evaluations/azure-safety-env.server";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  evaluatorsSchema,
} from "../../evaluations/evaluators";
import { evaluatorUnavailability } from "../../evaluations/installedEvaluators";
import { runEvaluationForTrace } from "../../evaluations/runEvaluation";
import { mappingStateSchema } from "../../tracer/tracesMapping";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { getUserProtectionsForProject } from "../utils";

const logger = createLogger("langwatch:evaluations");

export const evaluationsRouter = createTRPCRouter({
  availableEvaluators: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ input, ctx }) => {
      // Azure Safety evaluators resolve their credentials solely from the
      // project's azure_safety Model Provider. There is no process.env
      // fallback, so an unconfigured provider reports them as missing.
      // Computed once and reused for all three Azure evaluator types.
      const azureSafetyEnv = await getAzureSafetyEnvFromProject(
        ctx.app.modelProviders,
        input.projectId,
      );
      const azureMissingEnvVars = azureSafetyEnv ? [] : [...AZURE_SAFETY_ENV_VARS];

      return Object.fromEntries(
        Object.entries(AVAILABLE_EVALUATORS).map(([key, evaluator]) => [
          key,
          {
            ...evaluator,
            missingEnvVars: isAzureEvaluatorType(key)
              ? azureMissingEnvVars
              : evaluator.envVars.filter((envVar) => !process.env[envVar]),
            // Set when this install does not have the evaluator's code at
            // all, which is a different thing from it being unconfigured.
            unavailable: evaluatorUnavailability({ evaluatorType: key }),
          },
        ]),
      );
    }),

  availableCustomEvaluators: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("evaluations:view")
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
    .permission("evaluations:manage")
    .mutation(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const result = await runEvaluationForTrace({
        projectId: input.projectId,
        traceId: input.traceId,
        evaluatorType: input.evaluatorType as EvaluatorTypes,
        settings: input.settings,
        mappings: input.mappings ?? null,
        protections,
        evaluations: ctx.app.evaluations,
        modelProviders: ctx.app.modelProviders,
        managedProviders: ctx.app.managedProviders,
        workflows: ctx.app.workflows,
        traceCanonicalisation: ctx.app.traces.canonicalisation,
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
          await ctx.app.evaluations.reportEvaluation({
            tenantId: input.projectId,
            evaluationId,
            evaluatorId: input.evaluatorType,
            evaluatorType: input.evaluatorType,
            traceId: input.traceId,
            status: result.status,
            score:
              result.status === "processed" && typeof result.score === "number"
                ? result.score
                : undefined,
            passed:
              result.status === "processed" ? (result.passed ?? undefined) : undefined,
            label:
              result.status === "processed" ? (result.label ?? undefined) : undefined,
            details:
              result.status === "error"
                ? result.details
                : result.status === "processed"
                  ? (result.details ?? undefined)
                  : undefined,
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
    .permission("evaluations:view")
    .mutation(async ({ input, ctx }) => {
      const { projectId, count } = input;

      logger.debug({ projectId, count }, "Warming up Lambda instances");

      // Send parallel warmup requests
      const warmupPromises = Array.from({ length: count }, () =>
        studioBackendPostEvent({
          projectId,
          nlpLambda: ctx.app.nlpLambda,
          modelProviders: ctx.app.modelProviders,
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

export const getCustomEvaluators = async ({ projectId }: { projectId: string }) => {
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
    versions: workflow.versions.filter((version) => version.id === workflow.publishedId),
  }));
};
