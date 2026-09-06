/**
 * ComposedEvaluationFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
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
