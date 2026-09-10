/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { PromptApp } from "@langwatch/prompt-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import type { createPromptTrpcRouters } from "./prompt-trpc.mount.ts";
import type { mountPromptsRest } from "./prompt-rest.mount.ts";

/** What the process reads off an installed prompt library. */
export type ComposedPromptFeature = Readonly<{
  /** For `ctx.app.prompts`, and every other door that reaches a project's prompts directly. */
  app: PromptApp;
  /** `prompts.*` and `promptTags.*`, mounted on this process's own tRPC root. */
  routers: (mount: ApiTrpcFeatureMount) => ReturnType<typeof createPromptTrpcRouters>;
  /** `/api/prompts`, mounted on this process's own REST root. */
  rest: (runtime: ApiRestRuntime) => ReturnType<typeof mountPromptsRest>;
}>;
