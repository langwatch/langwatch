/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { OpsApp } from "@langwatch/ops-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createOpsTrpcRouter } from "./ops-trpc.mount.ts";

/** The operator application, its ports and the gate the namespace is behind. */
export type ComposedOpsFeature = Readonly<{
  /** The `ctx.app.ops` slice, which other surfaces' staff checks read. */
  app: OpsApp;
  /** `ops.*`, built on the process's own root and its own operator chain. */
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createOpsTrpcRouter>;
}>;
