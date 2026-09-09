import { defineFeature } from "@langwatch/runtime-composition";
import { AnalyticsApp } from "./app/analytics.app.ts";
import { analyticsLegacyRest } from "./transport/analytics-legacy.rest.ts";
import { analyticsLwqlTrpcTransport } from "./transport/analytics-lwql.trpc.ts";
import { analyticsRest } from "./transport/analytics.rest.ts";
import { analyticsTrpcTransport } from "./transport/analytics.trpc.ts";
import { queryRest } from "./transport/query.rest.ts";
import { savedWorkbenchChartRest } from "./transport/saved-workbench-chart.rest.ts";

export type { AnalyticsInfrastructure } from "./app/analytics.app.ts";

export const analyticsServer = defineFeature("analytics")
  .withApp(AnalyticsApp)
  .withTransports(
    analyticsRest,
    analyticsLegacyRest,
    queryRest,
    savedWorkbenchChartRest,
    analyticsTrpcTransport,
    analyticsLwqlTrpcTransport,
  )
  .build();
