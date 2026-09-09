/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { WorkflowApp } from "@langwatch/workflow-server";
import type { WorkflowService } from "@langwatch/workflow-contract";

/** The `ctx.app.workflows` application. The two tRPC namespaces are not here:
 * their transports are unconverted. */
export type ComposedWorkflowFeature = Readonly<{
  /** For `ctx.app.workflows`, and for the packaged workflow REST family. */
  app: WorkflowApp;
  /**
   * The studio graph service itself, where this process composed one.
   */
  service?: WorkflowService | undefined;
}>;
