/** Kept apart from the composition so the router/app type never pulls in the installer. */
import type { ShareApi } from "@langwatch/share-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createPinnedTraceTrpcRouter, createShareTrpcRouter } from "./share-trpc.mount.ts";

/** The two namespaces and the `ctx.app.share` ledger every share door reads. */
export type ComposedShareFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    share: ReturnType<typeof createShareTrpcRouter<ApiTrpcContext>>;
    pinnedTrace: ReturnType<typeof createPinnedTraceTrpcRouter<ApiTrpcContext>>;
  };
  /** For `ctx.app.share` — the one ledger every share door reads. */
  app: ShareApi;
}>;
