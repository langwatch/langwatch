/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { PromptApp } from "@langwatch/prompt-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createPromptTrpcRouter } from "./prompt-trpc.mount";

/** The namespace and the `ctx.app.prompts` slice two other doors read. */
export type ComposedPromptFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createPromptTrpcRouter>;
  /** For `ctx.app.prompts`. */
  app: PromptApp;
}>;
