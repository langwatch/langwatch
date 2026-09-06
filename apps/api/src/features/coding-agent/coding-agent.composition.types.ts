/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { CodingAgentApp } from "@langwatch/coding-agent-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createCodingAgentTrpcRouter } from "./coding-agent-trpc.mount";

/** The one namespace this feature mounts, and its `ctx.app` application. */
export type ComposedCodingAgentFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createCodingAgentTrpcRouter>;
  /** For `ctx.app.codingAgentApp`. */
  app: CodingAgentApp;
  /**
   * The same application, where this process composed one, for the packaged coding-agent
   * REST family.
   */
  service?: CodingAgentApp | undefined;
}>;
