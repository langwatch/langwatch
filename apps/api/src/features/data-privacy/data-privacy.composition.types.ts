/**
 * ComposedDataPrivacyFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createDataPrivacyTrpcRouter } from "./data-privacy-trpc.mount";

/** The one namespace, built over the composed rules. */
export type ComposedDataPrivacyFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createDataPrivacyTrpcRouter>;
  // The interlock the ingest edge asks before it externalizes inline media:
  // storing bytes for a project whose policy is about to discard them keeps
  // exactly what the customer asked us not to.

  /** True when this project's resolved policy drops any span content at all. */
  dropsAnyContent(projectId: string): Promise<boolean>;
}>;
