/**
 * ComposedEvaluatorFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
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
