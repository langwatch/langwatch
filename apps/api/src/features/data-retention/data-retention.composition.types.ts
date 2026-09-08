/** Kept separate from the composition so importing the router type never pulls in the installer. */
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createDataRetentionTrpcRouter } from "./data-retention-trpc.mount.ts";

/** The namespace, and the retention window every other surface is bounded by. */
export type ComposedDataRetentionFeature = Readonly<{
  router(
    mount: ApiTrpcFeatureMount,
  ): ReturnType<typeof createDataRetentionTrpcRouter<ApiTrpcContext>>;
  /**
   * For `ctx.app.dataRetention`, and for every other surface a retention window bounds:
   * the trace read stack's own floor, a share link's expiry and the storage meter all
   * read THIS app.
   */
  service: DataRetentionApi;
}>;
