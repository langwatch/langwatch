/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createEvaluationTrpcRouter } from "./evaluation-trpc.mount";

/** The namespace, the `ctx.app.evaluations` slice and the pipeline sender. */
export type ComposedEvaluationFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createEvaluationTrpcRouter>;
  /** For `ctx.app.evaluations`. */
  app: Readonly<{ reportEvaluation(data: never): Promise<unknown> }>;
  /**
   * The pipeline sender itself, as the experiment run loop and the evaluator
   * runtime take it. ONE registration, handed out rather than repeated.
   */
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<unknown>;
}>;
