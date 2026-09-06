/**
 * ComposedModelProviderFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { ModelProviderApp } from "@langwatch/model-provider-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type {
  createLlmModelCostTrpcRouter,
  createModelProviderTrpcRouter,
} from "./model-provider-trpc.mount";
import type { createTranslateTrpcRouter } from "./translate-trpc.mount";

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
