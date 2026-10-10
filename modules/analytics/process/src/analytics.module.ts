import { type AnalyticsApi, type AnalyticsServerConfig } from "@langwatch/analytics-contract";
import { keyCredentialOfRequest } from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { AnalyticsModule } from "./app/analytics.app.ts";
import { analyticsChannels } from "./channels/analytics-channels.registry.ts";
import { lwqlReconvergenceEventing } from "./eventing/analytics-lwql-reconvergence.pipeline.ts";
import { analyticsRepositories } from "./repositories/analytics-repositories.registry.ts";
import { AnalyticsComparisonWindowService } from "./services/analytics-comparison-window.service.ts";
import { analyticsLegacyRest } from "./transport/analytics-legacy.rest.ts";
import { analyticsLwqlTrpcTransport } from "./transport/analytics-lwql.trpc.ts";
import { analyticsRest } from "./transport/analytics.rest.ts";
import { analyticsTrpcTransport } from "./transport/analytics.trpc.ts";
import { queryRest } from "./transport/query.rest.ts";

export const analyticsProcessModule: PublishedProcessModule<
  "analytics",
  AnalyticsApi,
  AnalyticsServerConfig
> = defineProcessModule("analytics")
  .withRepositories(analyticsRepositories)
  .withChannels(analyticsChannels)
  .withApi(AnalyticsModule)
  .withTransports(
    analyticsRest,
    analyticsLegacyRest,
    queryRest,
    analyticsTrpcTransport,
    analyticsLwqlTrpcTransport,
  )
  // The query door fans the key it authenticated out to the projects it may read.
  .provideMiddlewareContext({
    langWatchQLKeyReach: (request) => keyCredentialOfRequest(request),
  })
  // Worker-hosted: the access-model reconvergence watch (ADR-159) and the key-map row (§9).
  .withEventing(lwqlReconvergenceEventing)
  .withMigrations(({ app }) => [
    defineMigrationStep({
      id: "analytics:fill-lwql-project-keys",
      kind: "data",
      mode: "background",
      description: "Fills LangWatchQL's key map with every project's key that it lacks.",
      // Level-triggered: a rerun reads the map again and inserts only what is still missing.
      run: ({ dryRun }) => app.fillLwqlProjectKeys({ dryRun }),
    }),
  ]);

/** Where the window immediately before a requested period begins. */
export function createAnalyticsComparisonWindow(): AnalyticsComparisonWindowService {
  return AnalyticsComparisonWindowService.create();
}
