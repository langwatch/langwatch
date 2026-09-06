/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ModelProviderApp } from "@langwatch/model-provider-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type {
  createLlmModelCostTrpcRouter,
  createModelProviderTrpcRouter,
} from "./model-provider-trpc.mount.ts";
import type { createTranslateTrpcRouter } from "./translate-trpc.mount.ts";

/** The three namespaces and the `ctx.app.modelProviders` slice. */
export type ComposedModelProviderFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    modelProvider: ReturnType<typeof createModelProviderTrpcRouter>;
    llmModelCost: ReturnType<typeof createLlmModelCostTrpcRouter>;
    translate: ReturnType<typeof createTranslateTrpcRouter>;
  };
  /** For `ctx.app.modelProviders`. */
  app: ModelProviderApp;
}>;
