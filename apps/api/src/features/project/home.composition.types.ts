/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createHomeTrpcRouter } from "./project-trpc.mount.ts";

/** The one namespace this feature mounts. */
export type ComposedHomeFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createHomeTrpcRouter<ApiTrpcContext>>;
}>;
