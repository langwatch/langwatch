import { langWatchQLCallerProtections } from "@langwatch/analytics-contract";
import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { DashboardApp } from "./app/dashboard.app.ts";
import { dashboardRepositories } from "./repositories/dashboard-repositories.registry.ts";
import { dashboardWidgetRest, dashboardWidgetUrl } from "./transport/dashboard-widget.rest.ts";
import { dashboardWidgetTrpcTransport } from "./transport/dashboard-widget.trpc.ts";
import { dashboardRest } from "./transport/dashboard.rest.ts";
import { dashboardTrpcTransport } from "./transport/dashboard.trpc.ts";
import { graphRest } from "./transport/graph.rest.ts";
import { graphTrpcTransport } from "./transport/graph.trpc.ts";
import { savedViewTrpcTransport } from "./transport/saved-view.trpc.ts";
import {
  savedWorkbenchChartRest,
  savedWorkbenchChartUrl,
} from "./transport/saved-workbench-chart.rest.ts";
import { savedWorkbenchChartTrpcTransport } from "./transport/saved-workbench-chart.trpc.ts";

export const dashboardServer = defineServerModule("dashboard")
  .withRepositories(dashboardRepositories)
  .withApp(DashboardApp)
  .withTransports(
    dashboardRest,
    dashboardWidgetRest,
    graphRest,
    savedWorkbenchChartRest,
    dashboardTrpcTransport,
    graphTrpcTransport,
    savedViewTrpcTransport,
    savedWorkbenchChartTrpcTransport,
    dashboardWidgetTrpcTransport,
  )
  // The saved-workbench-chart family declares these facts: the credential's
  // own project content protections, and the deployment's deep link back into
  // the analytics workbench — both resolved through the peer analytics app,
  // exactly as the query door itself resolves the first.
  .withTransportFacts(({ app, dependencies }) => [
    bindRestMiddleware(langWatchQLCallerProtections, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);

      return dependencies.analytics.resolveApiKeyProtections({
        projectId: credential.project.id,
        credential: credentialPrincipalOfToken(credential),
      });
    }),
    bindRestMiddleware(savedWorkbenchChartUrl, (context) =>
      dependencies.analytics.savedWorkbenchChartPlatformUrl({
        projectSlug: projectCredentialOfRequest(context.req.raw).project.slug,
      }),
    ),
    bindRestMiddleware(dashboardWidgetUrl, (context) =>
      app.dashboardWidgetPlatformUrl({
        projectSlug: projectCredentialOfRequest(context.req.raw).project.slug,
      }),
    ),
  ]);
