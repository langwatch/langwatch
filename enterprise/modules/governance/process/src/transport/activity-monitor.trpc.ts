// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `activityMonitor.*`: every read under `activityMonitor:view`, as on
 * main. Main's Enterprise gate is the application's per-organization refusal.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, activityMonitorTrpc } from "@langwatch/enterprise-governance-contract";

export const activityMonitorTrpcTransport = defineTrpcRouter(GovernanceRestApi, activityMonitorTrpc)
  .procedure("summary")
  .withPermission("activityMonitor:view")
  .handle(({ app, input, actor }) => app.activitySummary(input, actor))

  .procedure("spendByUser")
  .withPermission("activityMonitor:view")
  .handle(({ app, input, actor }) => app.activitySpendByUser(input, actor))

  .procedure("spendByTeam")
  .withPermission("activityMonitor:view")
  .handle(({ app, input, actor }) => app.activitySpendByTeam(input, actor))

  .procedure("spendByDepartment")
  .withPermission("activityMonitor:view")
  .handle(({ app, input, actor }) => app.activitySpendByDepartment(input, actor))

  .procedure("spendOverTime")
  .withPermission("activityMonitor:view")
  .handle(({ app, input, actor }) => app.activitySpendOverTime(input, actor))

  .procedure("ingestionSourcesHealth")
  .withPermission("activityMonitor:view")
  .handle(({ app, input, actor }) => app.activityIngestionSourcesHealth(input, actor))

  .procedure("recentAnomalies")
  .withPermission("activityMonitor:view")
  .handle(({ app, input, actor }) => app.activityRecentAnomalies(input, actor))

  .procedure("eventsForSource")
  .withPermission("activityMonitor:view")
  .handle(({ app, input, actor }) => app.activityEventsForSource(input, actor))

  .procedure("sourceHealthMetrics")
  .withPermission("activityMonitor:view")
  .handle(({ app, input, actor }) => app.activitySourceHealthMetrics(input, actor))
  .build();
