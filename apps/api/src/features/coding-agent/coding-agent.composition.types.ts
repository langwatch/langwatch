/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { CodingAgentApp } from "@langwatch/coding-agent-server";

/** This feature's `ctx.app` application. Its tRPC namespace is not here: the
 * transport is unconverted. */
export type ComposedCodingAgentFeature = Readonly<{
  /** For `ctx.app.codingAgentApp`. */
  app: CodingAgentApp;
  /**
   * The same application, where this process composed one, for the packaged coding-agent
   * REST family.
   */
  service?: CodingAgentApp | undefined;
}>;
