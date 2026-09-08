/** Kept separate from the composition so importing the router type never pulls in the installer. */
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createDataPrivacyTrpcRouter } from "./data-privacy-trpc.mount.ts";

/** The one namespace, and the policy every other surface is redacted under. */
export type ComposedDataPrivacyFeature = Readonly<{
  router(
    mount: ApiTrpcFeatureMount,
  ): ReturnType<typeof createDataPrivacyTrpcRouter<ApiTrpcContext>>;
  /**
   * For `ctx.app.dataPrivacy`, and for every other surface a resolved policy
   * bounds: the trace read stack redacts by THIS app, and the ingest edge asks
   * it whether a project's policy drops any content before it stores bytes.
   */
  app: DataPrivacyApi;
}>;
