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
import { dashboardWidgetRest } from "./transport/dashboard-widget.rest.ts";
import { langWatchQLCallerProtections, queryRest } from "./transport/query.rest.ts";
import { savedWorkbenchChartRest } from "./transport/saved-workbench-chart.rest.ts";

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
  ])
  .build();
