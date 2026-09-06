/**
 * ComposedApiKeyFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { ApiKeyApp } from "@langwatch/api-key-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createApiKeyTrpcRouter } from "./api-key-trpc.mount";

/** The one namespace this feature mounts, and the slice behind it. */
export type ComposedApiKeyFeature = Readonly<{
  /** The `ctx.app.apiKeys` slice. */
  app: ApiKeyApp;
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createApiKeyTrpcRouter>;
}>;
