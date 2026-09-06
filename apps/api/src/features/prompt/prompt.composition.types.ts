/**
 * ComposedPromptFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { PromptApp } from "@langwatch/prompt-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createPromptTrpcRouter } from "./prompt-trpc.mount";

/** The namespace and the `ctx.app.prompts` slice two other doors read. */
export type ComposedPromptFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createPromptTrpcRouter>;
  /** For `ctx.app.prompts`. */
  app: PromptApp;
}>;
