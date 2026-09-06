/**
 * ComposedShareFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { ShareService } from "@langwatch/share-contract";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createPinnedTraceTrpcRouter, createShareTrpcRouter } from "./share-trpc.mount";

/** The two namespaces and the service `ctx.app.share` carries. */
export type ComposedShareFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    share: ReturnType<typeof createShareTrpcRouter>;
    pinnedTrace: ReturnType<typeof createPinnedTraceTrpcRouter>;
  };
  /** For `ctx.app.share` — the one ledger every share door reads. */
  service: ShareService;
}>;
