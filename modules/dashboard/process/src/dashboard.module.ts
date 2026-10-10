import { credentialPrincipalOfToken, projectCredentialOfRequest } from "@langwatch/api/rest";
import type { DashboardApi, DashboardServerConfig } from "@langwatch/dashboard-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { DashboardModule } from "./app/dashboard.app.ts";
import { dashboardRepositories } from "./repositories/dashboard-repositories.registry.ts";
import { widgetSourceOfCredential } from "./rules/dashboard-widget-source.rules.ts";
import { dashboardWidgetRest } from "./transport/dashboard-widget.rest.ts";
import { dashboardWidgetTrpcTransport } from "./transport/dashboard-widget.trpc.ts";
import { dashboardRest } from "./transport/dashboard.rest.ts";
import { dashboardTrpcTransport } from "./transport/dashboard.trpc.ts";
import { graphRest } from "./transport/graph.rest.ts";
import { graphTrpcTransport } from "./transport/graph.trpc.ts";
import { savedViewTrpcTransport } from "./transport/saved-view.trpc.ts";
import { savedWorkbenchChartRest } from "./transport/saved-workbench-chart.rest.ts";
import { savedWorkbenchChartTrpcTransport } from "./transport/saved-workbench-chart.trpc.ts";

export const dashboardProcessModule: PublishedProcessModule<
  "dashboard",
  DashboardApi,
  DashboardServerConfig
> = defineProcessModule("dashboard")
  .withRepositories(dashboardRepositories)
  .withApi(DashboardModule)
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
  // The saved-workbench-chart family declares this middleware context: the credential's
  // own project content protections, and the deployment's deep link back into
  // the analytics workbench — both resolved through the peer analytics app,
  // exactly as the query door itself resolves the first.
  .provideMiddlewareContext({
    langWatchQLCallerProtections: (request, { dependencies }) => {
      const credential = projectCredentialOfRequest(request);

      return dependencies.analytics.resolveApiKeyProtections({
        projectId: credential.project.id,
        credential: credentialPrincipalOfToken(credential),
      });
    },
    savedWorkbenchChartUrl: (request, { dependencies }) =>
      dependencies.analytics.savedWorkbenchChartPlatformUrl({
        projectSlug: projectCredentialOfRequest(request).project.slug,
      }),
    dashboardWidgetUrl: (request, { app }) =>
      app.dashboardWidgetPlatformUrl({
        projectSlug: projectCredentialOfRequest(request).project.slug,
      }),
    dashboardWidgetCallerSource: (request) =>
      widgetSourceOfCredential({ credential: projectCredentialOfRequest(request) }),
  });
