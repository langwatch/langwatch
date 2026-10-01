import { langWatchQLKeyReach } from "@langwatch/analytics-contract";
import { bindRestMiddleware, keyCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/process";

import { AnalyticsApp } from "./app/analytics.app.ts";
import { lwqlReconvergenceEventing } from "./eventing/analytics-lwql-reconvergence.pipeline.ts";
import { AnalyticsComparisonWindowService } from "./services/analytics-comparison-window.service.ts";
import { LegacyFilterMatchingService } from "./services/legacy-filter-matching.service.ts";
import { PreconditionTraceDataService } from "./services/precondition-trace-data.service.ts";
import { analyticsLegacyRest } from "./transport/analytics-legacy.rest.ts";
import { analyticsLwqlTrpcTransport } from "./transport/analytics-lwql.trpc.ts";
import { analyticsRest } from "./transport/analytics.rest.ts";
import { analyticsTrpcTransport } from "./transport/analytics.trpc.ts";
import { queryRest } from "./transport/query.rest.ts";

export type { AnalyticsInfrastructure } from "./app/analytics.app.ts";

export const analyticsServer = defineServerModule("analytics")
  .withApp(AnalyticsApp)
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

/**
 * Filter matching without a query engine: the legacy `filters` grammar decided
 * in memory, for a settled automation match re-checked in a background process
 * with no ClickHouse round trip to spend.
 */
export function createLegacyFilterMatching(): LegacyFilterMatchingService {
  return LegacyFilterMatchingService.create();
}

/** The trace shape the in-memory filter matching reads a fold state as. */
export function createPreconditionTraceData(): PreconditionTraceDataService {
  return PreconditionTraceDataService.create();
}
