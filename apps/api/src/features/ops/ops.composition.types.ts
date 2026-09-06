/**
 * ComposedOpsFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { OpsApp } from "@langwatch/ops-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createOpsTrpcRouter } from "./ops-trpc.mount";

/** The operator application, its ports and the gate the namespace is behind. */
export type ComposedOpsFeature = Readonly<{
  /** The `ctx.app.ops` slice, which other surfaces' staff checks read. */
  app: OpsApp;
  /** `ops.*`, built on the process's own root and its own operator chain. */
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createOpsTrpcRouter>;
}>;
