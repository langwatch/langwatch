/**
 * The project's dashboards, the graphs on them, the saved workbench charts
 * they place, and the explorer's saved views — installed over this process's
 * own graph.
 */
import {
  AnalyticsApi,
  type AnalyticsApi as AnalyticsApiContract,
  type LangWatchQLCaller,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import type { PlatformUrlBuilder } from "@langwatch/api/rest";
import {
  AutomationApi,
  type AutomationApi as AutomationApiContract,
  type Trigger,
} from "@langwatch/automation-contract";
import {
  dashboardServer,
  type AlertRedaction,
  type PlatformUrl,
  type WorkbenchAccess,
  type WorkbenchCaller,
} from "@langwatch/dashboard-server";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import {
  createDashboardTrpcRouter,
  createGraphTrpcRouter,
  createSavedViewTrpcRouter,
  createSavedWorkbenchChartTrpcRouter,
} from "./dashboard-trpc.mount.ts";
import type { ComposedDashboardFeature } from "./dashboard.composition.types.ts";

/** The other features' apps the dashboard surfaces read. */
export type DashboardPeers = Readonly<{
  /** Validates and executes the LangWatchQL a saved chart holds. */
  analytics: AnalyticsApiContract;
  /** The alert automations watching a chart card. */
  automation: AutomationApiContract;
  /** Resolves the project slug a dashboard's address is built from. */
  projects: ProjectApiContract;
}>;

/** What this deployment answers that Dashboard cannot answer for itself. */
export type DashboardProcessPorts = Readonly<{
  /** LangWatchQL's own rollout flag for the project. */
  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
  /** What one member may read of this project's content. */
  resolveProtections(input: {
    actorId: string;
    projectId: string;
  }): Promise<LangWatchQLProtections>;
  /** The restricted identity a member's saved statement runs as. */
  resolveRunCaller(input: {
    actorId: string;
    projectId: string;
  }): Promise<Readonly<{ project: LangWatchQLCaller; protections: LangWatchQLProtections }>>;
  /** Strips the provider secrets an alert's parameters carry. */
  redactActionParams(
    action: Trigger["action"],
    actionParams: Record<string, unknown>,
  ): Record<string, unknown>;
  /** This deployment's public address builder. */
  platformUrl: PlatformUrlBuilder;
}>;

/** Installs the dashboard surfaces over this process's own connection. */
export async function installApiDashboard(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: DashboardPeers;
  ports: DashboardProcessPorts;
}): Promise<ComposedDashboardFeature> {
  const { prisma } = options.infrastructure;
  const { analytics, automation, projects } = options.peers;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withProvided(AnalyticsApi, analytics)
    .withProvided(AutomationApi, automation)
    .withProvided(ProjectApi, projects)
    .withModule(dashboardServer, {
      infrastructure: {
        workbenchAccess: new ProcessWorkbenchAccess(options.ports),
        workbenchCaller: new ProcessWorkbenchCaller(options.ports),
        alertRedaction: new ProcessAlertRedaction(options.ports),
        platformUrl: new ProcessPlatformUrl(options.ports),
      },
    })
    .boot({ role: "api" });

  const app = runtime.module(dashboardServer).provided;

  return {
    routers: (mount) => ({
      dashboards: createDashboardTrpcRouter(mount.runtime),
      graphs: createGraphTrpcRouter(mount.runtime),
      savedViews: createSavedViewTrpcRouter(mount.runtime),
      savedWorkbenchCharts: createSavedWorkbenchChartTrpcRouter(mount.runtime),
    }),
    app,
    restServices: { dashboard: () => app },
  };
}

class ProcessWorkbenchAccess implements WorkbenchAccess {
  constructor(private readonly ports: DashboardProcessPorts) {}

  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean> {
    return this.ports.isWorkbenchEnabled(input);
  }
}

class ProcessWorkbenchCaller implements WorkbenchCaller {
  constructor(private readonly ports: DashboardProcessPorts) {}

  resolveProtections(input: {
    actorId: string;
    projectId: string;
  }): Promise<LangWatchQLProtections> {
    return this.ports.resolveProtections(input);
  }

  resolveRunCaller(input: { actorId: string; projectId: string }) {
    return this.ports.resolveRunCaller(input);
  }
}

class ProcessAlertRedaction implements AlertRedaction {
  constructor(private readonly ports: DashboardProcessPorts) {}

  redactActionParams(
    action: Trigger["action"],
    actionParams: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.ports.redactActionParams(action, actionParams);
  }
}

class ProcessPlatformUrl implements PlatformUrl {
  constructor(private readonly ports: DashboardProcessPorts) {}

  linkTo(input: { projectSlug: string; path: string }): string {
    return this.ports.platformUrl(input);
  }
}
