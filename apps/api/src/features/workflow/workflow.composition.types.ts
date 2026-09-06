/**
 * ComposedWorkflowFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { WorkflowApp } from "@langwatch/workflow-server";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type {
  createWorkflowOptimizationTrpcRouter,
  createWorkflowTrpcRouter,
} from "./workflow-trpc.mount";

/** The two namespaces and the `ctx.app.workflows` application. */
export type ComposedWorkflowFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    workflow: ReturnType<typeof createWorkflowTrpcRouter>;
    optimization: ReturnType<typeof createWorkflowOptimizationTrpcRouter>;
  };
  /** For `ctx.app.workflows`, and for the packaged workflow REST family. */
  app: WorkflowApp;
  /**
   * The studio graph service itself, where this process composed one.
   */
  service?: WorkflowService | undefined;
}>;
