/**
 * Running and listing evaluators over the process's tRPC transport.
 *
 *   availableEvaluators:       every evaluator LangWatch knows, each annotated
 *                              with the environment variables this project is
 *                              missing and whether this install carries its
 *                              code at all.
 *   availableCustomEvaluators: the project's own workflow-backed evaluators.
 *   runEvaluation:             scores one trace with one evaluator, now, and
 *                              reports the result into the evaluation pipeline.
 *   warmupLambda:              keeps the evaluator runtime warm ahead of a run.
 *
 * Transport only: gates, input validation, and delegation to the evaluation
 * pipeline and the process ports below.
 *
 * Spec: specs/evaluators/azure-safety-byok-gating.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  AZURE_SAFETY_ENV_VARS,
  isAzureEvaluatorType,
  type ReportEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import {
  AVAILABLE_EVALUATORS,
  evaluatorsSchema,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

const logger = createLogger("langwatch:evaluations");

/**
 * The KSUID resource prefix a re-evaluation's id carries — the app's
 * `KSUID_RESOURCES.EVALUATION`.
 */
const EVALUATION_KSUID_RESOURCE = "eval";

/**
 * The result one evaluator run produces, plus the two fields the trace-side
 * runner adds to it.
 */
export type EvaluationRunOutcome = SingleEvaluationResult & {
  evaluation_thread_id?: string;
  inputs?: Record<string, unknown>;
};

/** Why an evaluator cannot run on this install, in the reader's terms. */
export type EvaluatorUnavailability = Readonly<{
  /** What is true, in the person's terms. */
  reason: string;
  /** What they do about it. */
  howToEnable: string;
}>;

type EvaluationApplication = Readonly<{
  /**
   * The evaluation command surface. `reportEvaluation` is a pipeline command
   * rather than a service method, so it is named here structurally.
   */
  evaluations: Readonly<{
    reportEvaluation(data: ReportEvaluationCommandData): Promise<unknown>;
  }>;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type EvaluationTrpcContext = Readonly<{
  app: EvaluationApplication;
  actor(): Readonly<{ id: string }>;
}>;

type EvaluationTrpcProcedures<
  TContext extends EvaluationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The process capabilities this transport needs that are not the evaluation
 * pipeline's own. Each that resolves per-request state is handed the request
 * context, so the process performs the work exactly as it always did.
 */
export type EvaluationTrpcPorts<TMappingsIn, TMappingsOut, TCustomEvaluator> = Readonly<{
  /**
   * The parser for a run's field mappings.
   *
   * Injected because which sources a mapping may name is the trace-mapping
   * registry's answer, not the evaluation's: the registry is what knows the
   * trace and thread sources and the expansions.
   */
  mappingsSchema: z.ZodType<TMappingsOut, TMappingsIn>;
  /**
   * Azure Content Safety credentials for a project, resolved solely from its
   * `azure_safety` model provider — there is no `process.env` fallback, so an
   * unconfigured provider deterministically resolves to null.
   */
  tryResolveAzureSafetyEnv(
    ctx: EvaluationTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<Record<string, string> | null>;
  /**
   * Why this install cannot run an evaluator, or undefined when it can. A
   * different thing from an evaluator being unconfigured: the code for it is
   * not here at all.
   */
  evaluatorUnavailability(
    input: Readonly<{ evaluatorType: string }>,
  ): EvaluatorUnavailability | undefined;
  /**
   * Which of an evaluator's declared environment variables this install does
   * not have set. The environment belongs to the process, so the answer is
   * injected rather than read from `process.env` here.
   */
  missingEnvironmentVariables(envVars: readonly string[]): string[];
  /** The project's published workflow-backed evaluators. */
  listCustomEvaluators(input: Readonly<{ projectId: string }>): Promise<TCustomEvaluator[]>;
  /** Scores one trace with one evaluator, resolving the caller's protections. */
  runEvaluationForTrace(
    ctx: EvaluationTrpcContext,
    input: Readonly<{
      projectId: string;
      traceId: string;
      evaluatorType: EvaluatorTypes;
      settings: Record<string, unknown>;
      mappings: TMappingsOut | null;
    }>,
  ): Promise<EvaluationRunOutcome>;
  /** Product analytics for a completed run. */
  trackEvaluationRan(input: Readonly<{ userId: string; projectId: string }>): void;
  /**
   * One liveness probe at the evaluator backend. `warmupLambda` sends several
   * in parallel; a failed probe is not an error, only a probe that did not
   * warm anything.
   */
  sendKeepAliveProbe(
    ctx: EvaluationTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<void>;
}>;

const projectScopeSchema = z.object({ projectId: z.string() });

const warmupInputSchema = z.object({
  projectId: z.string(),
  count: z.number().min(1).max(24).default(5),
});

/**
 * Installs the complete `evaluations.*` tRPC surface on a process-owned root.
 * The procedure and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class EvaluationTrpcApi {
  static create<
    TContext extends EvaluationTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TMappingsIn,
    TMappingsOut,
    TCustomEvaluator,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: EvaluationTrpcProcedures<TContext, TOptions, TRoot>,
    ports: EvaluationTrpcPorts<TMappingsIn, TMappingsOut, TCustomEvaluator>,
  ) {
    const { protected: procedure, policy } = procedures;

    const runEvaluationInputSchema = z.object({
      projectId: z.string(),
      evaluatorType: z.union([
        evaluatorsSchema.keyof(),
        z.string().refine((val) => val.startsWith("custom/")),
      ]),
      traceId: z.string(),
      settings: z.object({}).passthrough(),
      mappings: ports.mappingsSchema,
    });

    return trpc.router({
      availableEvaluators: policy("evaluations:view")(procedure.input(projectScopeSchema)).query(
        async ({ input, ctx }) => {
          // Azure Safety evaluators resolve their credentials solely from the
          // project's azure_safety Model Provider. There is no process.env
          // fallback, so an unconfigured provider reports them as missing.
          // Computed once and reused for all three Azure evaluator types.
          const azureSafetyEnv = await ports.tryResolveAzureSafetyEnv(ctx, {
            projectId: input.projectId,
          });
          const azureMissingEnvVars = azureSafetyEnv ? [] : [...AZURE_SAFETY_ENV_VARS];

          return Object.fromEntries(
            Object.entries(AVAILABLE_EVALUATORS).map(([key, evaluator]) => [
              key,
              {
                ...evaluator,
                missingEnvVars: isAzureEvaluatorType(key)
                  ? azureMissingEnvVars
                  : ports.missingEnvironmentVariables(evaluator.envVars),
                // Set when this install does not have the evaluator's code at
                // all, which is a different thing from it being unconfigured.
                unavailable: ports.evaluatorUnavailability({ evaluatorType: key }),
              },
            ]),
          );
        },
      ),

      availableCustomEvaluators: policy("evaluations:view")(
        procedure.input(projectScopeSchema),
      ).query(async ({ input }) => {
        const customEvaluators = await ports.listCustomEvaluators({
          projectId: input.projectId,
        });
        return customEvaluators;
      }),

      runEvaluation: policy("evaluations:manage")(
        procedure.input(runEvaluationInputSchema),
      ).mutation(async ({ input, ctx }) => {
        const result = await ports.runEvaluationForTrace(ctx, {
          projectId: input.projectId,
          traceId: input.traceId,
          evaluatorType: input.evaluatorType as EvaluatorTypes,
          settings: input.settings,
          mappings: input.mappings ?? null,
        });

        // Dispatch to evaluation processing pipeline when flag is ON
        if (result) {
          ports.trackEvaluationRan({
            userId: ctx.actor().id,
            projectId: input.projectId,
          });
        }

        // Dispatch to evaluation processing pipeline
        if (result) {
          const evaluationId = generate(EVALUATION_KSUID_RESOURCE).toString();
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
              passed: result.status === "processed" ? (result.passed ?? undefined) : undefined,
              label: result.status === "processed" ? (result.label ?? undefined) : undefined,
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
      warmupLambda: policy("evaluations:view")(procedure.input(warmupInputSchema)).mutation(
        async ({ input, ctx }) => {
          const { projectId, count } = input;

          logger.debug({ projectId, count }, "Warming up Lambda instances");

          // Send parallel warmup requests
          const warmupPromises = Array.from({ length: count }, () =>
            ports.sendKeepAliveProbe(ctx, { projectId }).catch((error: unknown) => {
              // Silently ignore errors - this is just warmup
              logger.debug({ error, projectId }, "Lambda warmup request failed");
            }),
          );

          await Promise.allSettled(warmupPromises);

          return { success: true, count };
        },
      ),
    });
  }
}
