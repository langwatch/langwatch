/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createHttpProxyTrpcRouter } from "./http-proxy-trpc.mount.ts";

/** The one namespace, built over the composed host. */
export type ComposedHttpProxyFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createHttpProxyTrpcRouter>;
}>;
