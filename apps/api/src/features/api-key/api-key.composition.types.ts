/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiKeyApp } from "@langwatch/api-key-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createApiKeyTrpcRouter } from "./api-key-trpc.mount.ts";

/** The one namespace this feature mounts, and the slice behind it. */
export type ComposedApiKeyFeature = Readonly<{
  /** The `ctx.app.apiKeys` slice. */
  app: ApiKeyApp;
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createApiKeyTrpcRouter>;
}>;
