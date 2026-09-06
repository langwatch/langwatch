/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createBugReportTrpcRouter } from "./bug-report-trpc.mount";

/** The one namespace, built over the composed inbox. */
export type ComposedBugReportFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createBugReportTrpcRouter>;
}>;
