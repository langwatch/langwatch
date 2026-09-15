/**
 * Every `evaluations.*` procedure, declared once. The names are the browser's
 * cache keys, so they are the wire names the surface has always called.
 * @see specs/evaluators/azure-safety-byok-gating.feature
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  customEvaluatorSchema,
  evaluationProjectScopeSchema,
  runTraceEvaluationInputSchema,
  warmupEvaluatorsInputSchema,
} from "./evaluation-trpc.schemas.ts";
import {
  evaluationRunOutcomeSchema,
  evaluationWarmupSchema,
  evaluatorCatalogueSchema,
} from "./evaluation.responses.ts";

export const evaluationTrpc = defineTrpcContract("evaluations")
  /**
   * Every evaluator LangWatch knows, each annotated with the environment
   * variables this project is missing and whether this install carries its
   * code at all.
   */
  .query("availableEvaluators")
  .withInput(evaluationProjectScopeSchema)
  .withOutput(evaluatorCatalogueSchema)

  /** The project's own workflow-backed evaluators. */
  .query("availableCustomEvaluators")
  .withInput(evaluationProjectScopeSchema)
  .withOutput(customEvaluatorSchema.array())

  /**
   * Scores one trace with one evaluator, now, and reports the result into the
   * evaluation pipeline.
   */
  .mutation("runEvaluation")
  .withInput(runTraceEvaluationInputSchema)
  .withOutput(evaluationRunOutcomeSchema)

  /** Keeps the evaluator runtime warm ahead of a run. */
  .mutation("warmupLambda")
  .withInput(warmupEvaluatorsInputSchema)
  .withOutput(evaluationWarmupSchema)
  .build();
