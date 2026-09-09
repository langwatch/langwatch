/** Kept separate from the composition so importing the router/app type never pulls in the installer. */
import type { EvaluatorApi, EvaluatorService } from "@langwatch/evaluator-contract";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createEvaluatorTrpcRouter } from "./evaluator-trpc.mount.ts";

/** The namespace, its `ctx.app` slice, and the lazy REST service entry. */
export type ComposedEvaluatorFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createEvaluatorTrpcRouter>;
  /** For `ctx.app.evaluatorApp`, which the evaluator REST family also reads. */
  app: EvaluatorApi;
  /**
   * The evaluator runtime the studio, the monitor half, the experiment wizard
   * and the re-score all run an evaluator through. The SAME one the app is
   * built over, published as a member so this process composes exactly one.
   */
  evaluators: EvaluatorService;
  /**
   * The lazy service entry the process's one REST list takes for this feature.
   * A provider rather than the application itself, so building the list never
   * forces construction - the OpenAPI generator builds it with none.
   */
  restServices: Readonly<{ evaluators: () => EvaluatorApi }>;
}>;
