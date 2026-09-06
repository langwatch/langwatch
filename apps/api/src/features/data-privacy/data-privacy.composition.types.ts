/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createDataPrivacyTrpcRouter } from "./data-privacy-trpc.mount.ts";

/** The one namespace, built over the composed rules. */
export type ComposedDataPrivacyFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createDataPrivacyTrpcRouter>;
  // The interlock the ingest edge asks before it externalizes inline media:
  // storing bytes for a project whose policy is about to discard them keeps
  // exactly what the customer asked us not to.

  /** True when this project's resolved policy drops any span content at all. */
  dropsAnyContent(projectId: string): Promise<boolean>;
}>;
