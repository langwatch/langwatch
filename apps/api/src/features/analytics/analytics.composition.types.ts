/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { LangWatchQLCaller, LangWatchQLProtections } from "@langwatch/analytics-contract";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { LangWatchQLService } from "@langwatch/analytics-server";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";

/** The two `ctx.app` slices, and what the REST doors take. The tRPC namespaces
 * are not here: their transport is unconverted. */
export type ComposedAnalyticsFeature = Readonly<{
  /** For `ctx.app.analytics`. */
  analytics: AnalyticsApi;
  /**
   * The three workbench answers the dashboard feature installs over. They are
   * this half's because a saved chart and the workbench statement behind it
   * must run as one caller under one set of protections.
   */
  dashboardPorts: Readonly<{
    isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
    resolveProtections(input: {
      actorId: string;
      projectId: string;
    }): Promise<LangWatchQLProtections>;
    resolveRunCaller(input: {
      actorId: string;
      projectId: string;
    }): Promise<Readonly<{ project: LangWatchQLCaller; protections: LangWatchQLProtections }>>;
  }>;
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
