/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { EvaluationApi, ReportEvaluationCommandData } from "@langwatch/evaluation-contract";

import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createEvaluationTrpcRouter } from "./evaluation-trpc.mount.ts";

/** The namespace, the `ctx.app.evaluations` slice and the pipeline sender. */
export type ComposedEvaluationFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    evaluations: ReturnType<typeof createEvaluationTrpcRouter<ApiTrpcContext>>;
  };
  /** For `ctx.app.evaluations`, which the tRPC mount resolves the app through. */
  app: EvaluationApi;
  /**
   * The pipeline sender itself, as the experiment run loop and the evaluator
   * runtime take it. ONE registration, handed out rather than repeated.
   */
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<unknown>;
}>;
