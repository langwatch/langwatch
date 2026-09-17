import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { AnalyticsApp } from "./app/analytics.app.ts";
import { analyticsLegacyRest } from "./transport/analytics-legacy.rest.ts";
import { analyticsLwqlTrpcTransport } from "./transport/analytics-lwql.trpc.ts";
import { analyticsRest } from "./transport/analytics.rest.ts";
import { analyticsTrpcTransport } from "./transport/analytics.trpc.ts";
import { dashboardWidgetRest, dashboardWidgetUrl } from "./transport/dashboard-widget.rest.ts";
import { langWatchQLCallerProtections, queryRest } from "./transport/query.rest.ts";
import {
  savedWorkbenchChartRest,
  savedWorkbenchChartUrl,
} from "./transport/saved-workbench-chart.rest.ts";

import {
  analyticsFilterValueSchema,
  type AnalyticsEvaluationReadMetrics,
  type AnalyticsService,
  type AnalyticsTripwire,
} from "@langwatch/analytics-contract";
import { z } from "zod";
import { AnalyticsComparisonWindowService } from "./services/analytics-comparison-window.service.ts";
import { AnalyticsAdapter } from "./app/analytics-composition.build.ts";
import { LegacyFilterMatchingService } from "./services/legacy-filter-matching.service.ts";
import { PreconditionTraceDataService } from "./services/precondition-trace-data.service.ts";
import { generateClickHouseFilterConditions } from "./rules/analytics-filter-conditions.rules.ts";
import type { EvaluationAnalyticsClickHouseClient } from "./repositories/clickhouse/clickhouse.analytics-persistence.repository.ts";
import type { GenerateFilterConditionsResult } from "./repositories/clickhouse/clickhouse.filter-shapes.mapper.ts";

export type { AnalyticsInfrastructure } from "./app/analytics.app.ts";

export const analyticsServer = defineServerModule("analytics")
  .withApp(AnalyticsApp)
  .withTransports(
    analyticsRest,
    analyticsLegacyRest,
    queryRest,
    savedWorkbenchChartRest,
    dashboardWidgetRest,
    analyticsTrpcTransport,
    analyticsLwqlTrpcTransport,
  )
  // Both the query door (`/api/v1/query`) and the saved-workbench-chart family
  // declare this same fact: what this credential's own project content and
  // spend protections resolve to. One binding covers every route naming it.
  .withTransportFacts(({ app }) => [
    bindRestMiddleware(langWatchQLCallerProtections, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);

      return app.resolveApiKeyProtections({
        projectId: credential.project.id,
        credential: credentialPrincipalOfToken(credential),
      });
    }),
    // The deployment's own public origin, resolved into the SAME deep link
    // shape the deleted `langwatch-ql-rest.mount.ts` built: the credential's
    // own project slug, never a project id, on the app's configured
    // `publicBaseUrl`.
    bindRestMiddleware(savedWorkbenchChartUrl, (context) =>
      app.savedWorkbenchChartPlatformUrl({
        projectSlug: projectCredentialOfRequest(context.req.raw).project.slug,
      }),
    ),
    bindRestMiddleware(dashboardWidgetUrl, (context) =>
      app.dashboardWidgetPlatformUrl({
        projectSlug: projectCredentialOfRequest(context.req.raw).project.slug,
      }),
    ),
  ]);

/**
 * The tenant-bound session both analytics repositories read through. It opens
 * the seams below: thin factories over the private services and rules, so a
 * composition root never names one directly.
 */
export type AnalyticsClickHouseClientResolver = (
  tenantId: string,
) => Promise<EvaluationAnalyticsClickHouseClient | null>;

export type AnalyticsServiceCompositionInput = {
  resolveClient: AnalyticsClickHouseClientResolver;
  clickhouseEnabled: boolean;
  tripwire?: AnalyticsTripwire;
  defaultRetentionDays?: number;
  evaluationReadMetrics?: AnalyticsEvaluationReadMetrics;
};

/** The one Analytics read API a process serves, over its own ClickHouse session. */
export function createAnalyticsService(input: AnalyticsServiceCompositionInput): AnalyticsService {
  return AnalyticsAdapter.create(input);
}

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

const legacyFiltersSchema = z.record(z.string(), analyticsFilterValueSchema);

/** The ClickHouse conditions one legacy `filters` document narrows a read by. */
export type ClickHouseFilterConditions = (
  filters: Record<string, unknown>,
  window?: { startDate?: number; endDate?: number },
) => GenerateFilterConditionsResult;

/**
 * Parses the legacy `filters` grammar and answers the conditions it means. The
 * parse travels with the grammar, not with each caller: a composition root
 * holding its own copy of the schema is a second place to drift.
 */
export function createClickHouseFilterConditions(): ClickHouseFilterConditions {
  return (filters, window) =>
    generateClickHouseFilterConditions(legacyFiltersSchema.parse(filters), window);
}
