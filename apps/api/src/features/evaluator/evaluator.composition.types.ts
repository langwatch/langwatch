/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { EvaluatorApp, EvaluatorTrpcPorts } from "@langwatch/evaluator-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createEvaluatorTrpcRouter } from "./evaluator-trpc.mount";

/** The namespace, its `ctx.app` slice, and the ports the monitor copy takes. */
export type ComposedEvaluatorFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createEvaluatorTrpcRouter>;
  /** For `ctx.app.evaluatorApp`. */
  app: EvaluatorApp;
  /** The replication half of these ports, taken by the monitor feature. */
  ports: EvaluatorTrpcPorts;
}>;
