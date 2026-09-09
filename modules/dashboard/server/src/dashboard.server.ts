import { defineModule } from "@langwatch/runtime-composition";

import { DashboardApp } from "./app/dashboard.app.ts";
import { dashboardRepositories } from "./repositories/dashboard-repositories.registry.ts";
import { dashboardRest } from "./transport/dashboard.rest.ts";
import { dashboardTrpcTransport } from "./transport/dashboard.trpc.ts";
import { graphRest } from "./transport/graph.rest.ts";
import { graphTrpcTransport } from "./transport/graph.trpc.ts";
import { savedViewTrpcTransport } from "./transport/saved-view.trpc.ts";
import { savedWorkbenchChartTrpcTransport } from "./transport/saved-workbench-chart.trpc.ts";

export const dashboardServer = defineModule("dashboard")
  .withRepositories(dashboardRepositories)
  .withApp(DashboardApp)
  .withTransports(
    dashboardRest,
    graphRest,
    dashboardTrpcTransport,
    graphTrpcTransport,
    savedViewTrpcTransport,
    savedWorkbenchChartTrpcTransport,
  )
  .build();
