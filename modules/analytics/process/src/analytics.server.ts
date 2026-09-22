import {
  analyticsFilterValueSchema,
  type AnalyticsEvaluationReadMetrics,
  type AnalyticsService,
  type AnalyticsTripwire,
} from "@langwatch/analytics-contract";
import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";
import { z } from "zod";

import { AnalyticsAdapter } from "./app/analytics-composition.build.ts";
import { AnalyticsApp } from "./app/analytics.app.ts";
import type { EvaluationAnalyticsClickHouseClient } from "./repositories/clickhouse/clickhouse.analytics-persistence.repository.ts";
import type { GenerateFilterConditionsResult } from "./repositories/clickhouse/clickhouse.filter-shapes.mapper.ts";
import { generateClickHouseFilterConditions } from "./rules/analytics-filter-conditions.rules.ts";
import { AnalyticsComparisonWindowService } from "./services/analytics-comparison-window.service.ts";
import { LegacyFilterMatchingService } from "./services/legacy-filter-matching.service.ts";
import { PreconditionTraceDataService } from "./services/precondition-trace-data.service.ts";
import { analyticsLegacyRest } from "./transport/analytics-legacy.rest.ts";
import { analyticsLwqlTrpcTransport } from "./transport/analytics-lwql.trpc.ts";
import { analyticsRest } from "./transport/analytics.rest.ts";
import { analyticsTrpcTransport } from "./transport/analytics.trpc.ts";
import {
  langWatchQLCallerProtections,
  langWatchQLCallerReach,
  queryRest,
} from "./transport/query.rest.ts";

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
  // The query door's own routes declare two facts: what this credential's own
  // project content and spend protections resolve to, and whether it reaches
  // LangWatchQL at all — the reference answers either way.
  .withTransportFacts(({ app }) => [
    bindRestMiddleware(langWatchQLCallerProtections, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);

      return app.resolveApiKeyProtections({
        projectId: credential.project.id,
        credential: credentialPrincipalOfToken(credential),
      });
    }),
    bindRestMiddleware(langWatchQLCallerReach, async (context) => ({
      canRunLangWatchQL: await app.canApiKeyRunLangWatchQL({
        credential: credentialPrincipalOfToken(projectCredentialOfRequest(context.req.raw)),
      }),
    })),
  ]);

/**
 * The tenant-bound session analytics' ClickHouse reads run through. It opens
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
