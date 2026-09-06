/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ShareService } from "@langwatch/share-contract";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createPinnedTraceTrpcRouter, createShareTrpcRouter } from "./share-trpc.mount.ts";

/** The two namespaces and the service `ctx.app.share` carries. */
export type ComposedShareFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    share: ReturnType<typeof createShareTrpcRouter>;
    pinnedTrace: ReturnType<typeof createPinnedTraceTrpcRouter>;
  };
  /** For `ctx.app.share` — the one ledger every share door reads. */
  service: ShareService;
}>;
