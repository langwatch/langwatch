import { langWatchQLKeyReach } from "@langwatch/analytics-contract";
import { bindRestMiddleware, keyCredentialOfRequest } from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { AnalyticsModule } from "./app/analytics.app.ts";
import { lwqlReconvergenceEventing } from "./eventing/analytics-lwql-reconvergence.pipeline.ts";
import { analyticsRepositories } from "./repositories/analytics-repositories.registry.ts";
import { AnalyticsComparisonWindowService } from "./services/analytics-comparison-window.service.ts";
import { analyticsLegacyRest } from "./transport/analytics-legacy.rest.ts";
import { analyticsLwqlTrpcTransport } from "./transport/analytics-lwql.trpc.ts";
import { analyticsRest } from "./transport/analytics.rest.ts";
import { analyticsTrpcTransport } from "./transport/analytics.trpc.ts";
import { queryRest } from "./transport/query.rest.ts";

export type { AnalyticsInfrastructure } from "./app/analytics.app.ts";

export const analyticsProcessModule = defineProcessModule("analytics")
  .withRepositories(analyticsRepositories)
  .withApi(AnalyticsModule)
  .withTransports(
    analyticsRest,
    analyticsLegacyRest,
    queryRest,
    analyticsTrpcTransport,
    analyticsLwqlTrpcTransport,
  )
  // The query door fans the key it authenticated out to the projects it may read.
  .withTransportFacts(() => [
    bindRestMiddleware(langWatchQLKeyReach, (context) => keyCredentialOfRequest(context.req.raw)),
  ])
  // Worker-hosted: the access-model reconvergence watch (ADR-159) and the key-map row (§9).
  .withEventing(lwqlReconvergenceEventing);

/** Where the window immediately before a requested period begins. */
export function createAnalyticsComparisonWindow(): AnalyticsComparisonWindowService {
  return AnalyticsComparisonWindowService.create();
}
