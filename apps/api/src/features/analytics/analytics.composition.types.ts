/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import type { AnalyticsApp, LangWatchQLService } from "@langwatch/analytics-server";
import type { DashboardApp } from "@langwatch/dashboard-server";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { analyticsRouters } from "./analytics-trpc.routers.ts";

/** The two namespaces, the two `ctx.app` slices, and what the REST doors take. */
export type ComposedAnalyticsFeature = Readonly<{
  /**
   * `analytics.*` and `graphs.*`, on the process's own root.
   */
  routers(mount: ApiTrpcFeatureMount): ReturnType<typeof analyticsRouters>;
  /** For `ctx.app.analytics`. */
  analytics: AnalyticsApp;
  /** For `ctx.app.dashboard`. */
  dashboard: DashboardApp;
  /**
   * The governed-SQL runner, the rollout switch it is behind, and the content protections
   * an API KEY resolves to — the three the public governed-SQL REST family needs and the
   * tRPC ports do not expose.
   */
  langWatchQL: LangWatchQLService;
  featureFlags: FeatureFlagApi;
  /** See {@link ApiAnalyticsProtections.resolveForApiKey}. */
  apiKeyProtections: (input: {
    projectId: string;
    credential: RestCredentialPrincipal;
  }) => Promise<LangWatchQLProtections>;
}>;
