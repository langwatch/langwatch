/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { CodingAgentApp } from "@langwatch/coding-agent-server";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createCodingAgentTrpcRouter } from "./coding-agent-trpc.mount.ts";

/** The one namespace and this feature's `ctx.app` application. */
export type ComposedCodingAgentFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createCodingAgentTrpcRouter<ApiTrpcContext>>;
  /** For `ctx.app.codingAgentApp`. */
  app: CodingAgentApp;
  /**
   * The same application, where this process composed one, for the packaged coding-agent
   * REST family.
   */
  service?: CodingAgentApp | undefined;
}>;
