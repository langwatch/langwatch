import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import type { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import type { ReportDispatcher } from "../eventing/report-schedule.intent.ts";
import type { AutomationRepositories } from "../repositories/automation.repositories.ts";
import type { AutomationProjectDirectory } from "./automation.service.ts";
import { ReportChartService } from "./report-chart.service.ts";
import { ReportDispatchService, type ReportDispatchDeps } from "./report-dispatch.service.ts";
import { ReportTraceListService } from "./report-trace-list.service.ts";
import type { SlackDestinationService } from "./slack-destination.service.ts";

/** Main's report handler (presets.ts, ADR-044 Phase 3c), over this module's own repositories. */
export class ReportDispatcherService implements ReportDispatcher {
  static create(input: {
    repositories: Pick<AutomationRepositories, "triggers" | "history" | "customGraphs">;
    projects: AutomationProjectDirectory;
    analytics: Pick<AnalyticsApi, "getTimeseries">;
    traces: Pick<TraceApi, "readTraceList" | "translateTraceFilter">;
    delivery: AutomationNotificationDelivery;
    slackDestinations: SlackDestinationService;
    suppression: { filterSuppressed: ReportDispatchDeps["filterSuppressedRecipients"] };
    baseHost: string;
  }): ReportDispatcherService {
    const { repositories } = input;
    const charts = ReportChartService.create({
      findCustomGraph: ({ projectId, customGraphId }) =>
        repositories.customGraphs.findById({ customGraphId, projectId }),
      loadDashboardGraphs: ({ projectId, dashboardId }) =>
        repositories.customGraphs.findAllByDashboardId({ dashboardId, projectId }),
      getTimeseries: (timeseries) => input.analytics.getTimeseries(timeseries),
    });
    const traceList = ReportTraceListService.create({
      traces: input.traces,
      baseHost: input.baseHost,
    });
    return new ReportDispatcherService(
      ReportDispatchService.create({
        findTrigger: ({ projectId, triggerId }) =>
          repositories.triggers.findById({ triggerId, projectId }),
        findProject: (projectId) => input.projects.findById(projectId),
        delivery: input.delivery,
        slackDestinations: input.slackDestinations,
        filterSuppressedRecipients: (recipients) => input.suppression.filterSuppressed(recipients),
        listReportTraces: (listInput) => traceList.list(listInput),
        loadReportCharts: (chartInput) => charts.loadReportCharts(chartInput),
        recordFire: async ({ projectId, triggerId, firedAt }) => {
          await repositories.history.create({
            projectId,
            triggerId,
            traceId: null,
            customGraphId: null,
            createdAt: firedAt,
            resolvedAt: firedAt,
          });
        },
        baseHost: input.baseHost,
      }),
    );
  }

  private constructor(private readonly reports: ReportDispatchService) {}

  dispatch({
    projectId,
    triggerId,
    slot,
  }: {
    projectId: string;
    triggerId: string;
    slot: number;
  }): Promise<void> {
    return this.reports.dispatchScheduledReport({
      projectId,
      triggerId,
      slot: Temporal.Instant.fromEpochMilliseconds(slot),
    });
  }
}
