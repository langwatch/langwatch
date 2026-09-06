/**
 * ComposedDataRetentionFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createDataRetentionTrpcRouter } from "./data-retention-trpc.mount";

/** The namespace, the composed policy, and the service every reader shares. */
export type ComposedDataRetentionFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createDataRetentionTrpcRouter>;
  /**
   * For `ctx.app.dataRetention`, and for every other surface a retention window bounds:
   * the trace read stack's own floor, a share link's expiry and the storage meter all
   * read THIS service.
   */
  service: DataRetentionService;
}>;
