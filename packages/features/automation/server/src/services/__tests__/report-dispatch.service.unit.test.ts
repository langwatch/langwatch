import type {
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import { buildSeriesName } from "@langwatch/analytics-contract";
import type {
  CustomGraph,
  ReportChart,
  ReportSource,
  SlackPayload,
  Trigger,
} from "@langwatch/automation-contract";
import type { ScheduledJobFire } from "@langwatch/eventing/server";
import { describe, expect, it, vi } from "vitest";
import { AutomationNotificationDeliveryPort } from "../../ports/automation-notification-delivery.port";
import { AutomationSlackProviderPort } from "../../ports/automation-provider.port";
import { loadReportCharts } from "../report-chart.service";
import { dispatchScheduledReport, type ReportDispatchDeps } from "../report-dispatch.service";
import { toReportTraceRow } from "../report-trace-row.service";

const BASE_HOST = "https://app.langwatch.test";
const PROJECT = { id: "project-1", name: "Checkout", slug: "checkout" };
/** 09:00 on a Wednesday, so the daily cron's previous slot is 24 hours back. */
const SLOT = new Date("2026-07-15T09:00:00Z");
const SCHEDULE = { cron: "0 9 * * *", timezone: "UTC" };

/**
 * The mail gateway a report actually leaves through, faked.
 *
 * It captures what `dispatchScheduledReport` handed the transport rather than
 * standing in for the dispatch itself: every assertion below reads the rendered
 * subject and body of a real send, so a report that renders an empty message or
 * never reaches the transport fails here rather than passing on a spy call.
 */
class FakeMailGateway extends AutomationNotificationDeliveryPort {
  readonly emails: Array<{ recipients: string[]; subject: string; html: string }> = [];
  readonly slackMessages: Array<{ payload: SlackPayload }> = [];

  async sendEmail(input: { recipients: string[]; subject: string; html: string }): Promise<void> {
    this.emails.push({
      recipients: input.recipients,
      subject: input.subject,
      html: input.html,
    });
  }

  async sendSlackWebhook(input: { payload: SlackPayload }): Promise<void> {
    this.slackMessages.push({ payload: input.payload });
  }

  async sendLegacyEmail(): Promise<void> {
    throw new Error("A report never sends the legacy trace digest.");
  }
  async sendLegacySlackWebhook(): Promise<void> {
    throw new Error("A report never sends the legacy trace digest.");
  }
  async sendSlackBot(): Promise<void> {
    throw new Error("This report is not configured for a bot connection.");
  }
  async sendWebhook(): Promise<never> {
    throw new Error("A report never sends a webhook.");
  }
}

class NoSlackTokens extends AutomationSlackProviderPort {
  tryDecrypt(): string | null {
    return null;
  }
}

function makeTrigger(overrides: Partial<Trigger> & { source: ReportSource }): Trigger {
  const { source, ...rest } = overrides;
  return {
    id: "report-1",
    projectId: PROJECT.id,
    name: "Weekly checkout report",
    action: "SEND_EMAIL",
    triggerKind: "REPORT",
    actionParams: {
      source,
      schedule: SCHEDULE,
      compareToPrevious: false,
      members: ["team@example.com"],
    },
    filters: {},
    filterQuery: null,
    active: true,
    deleted: false,
    pausedReason: null,
    pausedAt: null,
    message: null,
    alertType: null,
    customGraphId: null,
    notificationCadence: "IMMEDIATE",
    traceDebounceMs: 0,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    lastRunAt: null,
    ...rest,
  } as Trigger;
}

const FIRE: ScheduledJobFire = {
  projectId: PROJECT.id,
  targetType: "reportTrigger",
  targetId: "report-1",
  slot: SLOT,
};

function makeDeps({
  trigger,
  mail,
  listReportTraces,
  loadReportCharts: charts,
}: {
  trigger: Trigger;
  mail: FakeMailGateway;
  listReportTraces?: ReportDispatchDeps["listReportTraces"];
  loadReportCharts?: ReportDispatchDeps["loadReportCharts"];
}): ReportDispatchDeps & { recordFire: ReturnType<typeof vi.fn> } {
  const recordFire = vi.fn(async () => {});
  return {
    loadTrigger: async () => trigger,
    loadProject: async () => PROJECT,
    delivery: mail,
    slackProvider: new NoSlackTokens(),
    filterSuppressedRecipients: async ({ emails }) => emails,
    listReportTraces:
      listReportTraces ??
      (async () => {
        throw new Error("This report does not read traces.");
      }),
    loadReportCharts:
      charts ??
      (async () => {
        throw new Error("This report does not read charts.");
      }),
    recordFire,
    baseHost: BASE_HOST,
  };
}

/** A trace list row as ClickHouse hands it back, before the report maps it. */
function traceListItem(overrides: Record<string, unknown> = {}) {
  return {
    traceId: "trace-a",
    timestamp: SLOT.getTime(),
    input: "Where is my order?",
    output: "It ships tomorrow.",
    models: ["gpt-5-mini"],
    status: "error",
    totalCost: 0.0125,
    durationMs: 1234,
    ...overrides,
  };
}

const COUNT_SERIES = {
  metric: "metadata.trace_id",
  aggregation: "cardinality",
  name: "Traces",
};
const COUNT_KEY = buildSeriesName(COUNT_SERIES as never, 0);

function graphRow(overrides: Partial<CustomGraph> = {}): CustomGraph {
  return {
    id: "graph-1",
    projectId: PROJECT.id,
    name: "Traces per hour",
    filters: {},
    graph: {
      graphId: "graph-1",
      graphType: "line",
      series: [COUNT_SERIES],
      timeScale: 60,
    },
    ...overrides,
  } as CustomGraph;
}

/**
 * The chart reader wired the way the worker wires it: the REAL
 * `loadReportCharts` over a faked timeseries, so a report's panels are rendered
 * rather than handed to the dispatch pre-built.
 */
function chartReader({
  graphs,
  timeseries,
  getTimeseries,
}: {
  graphs: CustomGraph[];
  timeseries?: AnalyticsTimeseriesResult;
  getTimeseries?: (input: AnalyticsTimeseriesInput) => Promise<AnalyticsTimeseriesResult>;
}): ReportDispatchDeps["loadReportCharts"] {
  return ({ projectId, source, from, to }): Promise<ReportChart[]> =>
    loadReportCharts({
      deps: {
        loadCustomGraph: async () => graphs[0] ?? null,
        loadDashboardGraphs: async () => graphs,
        getTimeseries:
          getTimeseries ?? (async () => timeseries ?? { previousPeriod: [], currentPeriod: [] }),
      },
      source,
      projectId,
      from,
      to,
    });
}

describe("dispatchScheduledReport", () => {
  describe("given a report whose source is matching traces", () => {
    /** @scenario "A trace-query report sends the traces that matched" */
    it("sends the top traces matching the author's query over the report's window", async () => {
      const mail = new FakeMailGateway();
      const listReportTraces = vi.fn(async ({ projectSlug }: { projectSlug: string }) => [
        toReportTraceRow({
          item: traceListItem() as never,
          projectUrl: `${BASE_HOST}/${projectSlug}`,
        }),
      ]);
      const trigger = makeTrigger({
        source: { kind: "traceQuery", filters: {}, topN: 3 },
        filterQuery: "status:error",
      });

      await dispatchScheduledReport({
        deps: makeDeps({ trigger, mail, listReportTraces }),
        fire: FIRE,
      });

      expect(listReportTraces).toHaveBeenCalledWith({
        projectId: PROJECT.id,
        projectSlug: PROJECT.slug,
        query: "status:error",
        from: SLOT.getTime() - 24 * 60 * 60 * 1000,
        to: SLOT.getTime(),
        limit: 3,
      });
      const [email] = mail.emails;
      expect(email?.recipients).toEqual(["team@example.com"]);
      // The row carries its own cost, duration, model and status, not a link.
      expect(email?.html).toContain("trace-a");
      expect(email?.html).toContain(`${BASE_HOST}/${PROJECT.slug}/traces/trace-a`);
      expect(email?.html).toContain("gpt-5-mini");
      expect(email?.html).toContain("0.0125");
      expect(email?.html).toContain("1234");
      // Following the report's link opens the same traces.
      expect(email?.html).toContain(`${BASE_HOST}/${PROJECT.slug}/traces`);
    });

    /** @scenario "A trace-query report without a query sends the window's traces" */
    it("asks for the whole window when the author wrote no query", async () => {
      const mail = new FakeMailGateway();
      const listReportTraces: ReportDispatchDeps["listReportTraces"] = vi.fn(async () => [
        toReportTraceRow({
          item: traceListItem({ traceId: "trace-recent" }) as never,
          projectUrl: `${BASE_HOST}/${PROJECT.slug}`,
        }),
      ]);
      const trigger = makeTrigger({
        source: { kind: "traceQuery", filters: {}, topN: 5 },
        filterQuery: null,
      });

      await dispatchScheduledReport({
        deps: makeDeps({ trigger, mail, listReportTraces }),
        fire: FIRE,
      });

      expect(listReportTraces).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "",
          from: SLOT.getTime() - 24 * 60 * 60 * 1000,
          to: SLOT.getTime(),
        }),
      );
      expect(mail.emails[0]?.html).toContain("trace-recent");
    });
  });

  describe("given a report whose source is a custom graph", () => {
    /** @scenario "A custom-graph report sends the graph" */
    it("sends the graph's series plotted over the window, named with its headline value", async () => {
      const mail = new FakeMailGateway();
      const getTimeseries = vi.fn(async () => ({
        previousPeriod: [],
        currentPeriod: [
          { date: "2026-07-14T09:00:00Z", [COUNT_KEY]: 4 },
          { date: "2026-07-15T08:00:00Z", [COUNT_KEY]: 6 },
        ],
      }));
      const trigger = makeTrigger({
        source: { kind: "customGraph", customGraphId: "graph-1" },
      });

      await dispatchScheduledReport({
        deps: makeDeps({
          trigger,
          mail,
          loadReportCharts: chartReader({ graphs: [graphRow()], getTimeseries }),
        }),
        fire: FIRE,
      });

      expect(getTimeseries).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT.id,
          startDate: SLOT.getTime() - 24 * 60 * 60 * 1000,
          endDate: SLOT.getTime(),
        }),
      );
      const [email] = mail.emails;
      // The graph is named, and its headline value is the aggregate of the
      // series actually plotted over the window (4 + 6), not a link to it.
      expect(email?.html).toContain("Traces per hour</strong> — 10");
      expect(email?.html).not.toContain("Nothing to show for this period");
    });
  });

  describe("given a report whose source is a dashboard", () => {
    /** @scenario "A dashboard report sends every panel on the dashboard" */
    it("sends one chart per panel on that dashboard", async () => {
      const mail = new FakeMailGateway();
      const trigger = makeTrigger({
        source: { kind: "dashboard", dashboardId: "dashboard-1" },
      });

      await dispatchScheduledReport({
        deps: makeDeps({
          trigger,
          mail,
          loadReportCharts: chartReader({
            graphs: [
              graphRow({ id: "graph-1", name: "Traces per hour" }),
              graphRow({ id: "graph-2", name: "Spend per hour" }),
              graphRow({ id: "graph-3", name: "Errors per hour" }),
            ],
            timeseries: {
              previousPeriod: [],
              currentPeriod: [{ date: "2026-07-15T08:00:00Z", [COUNT_KEY]: 2 }],
            },
          }),
        }),
        fire: FIRE,
      });

      // One rendered chart per panel, in the dashboard's own order.
      const html = mail.emails[0]?.html ?? "";
      expect(html.match(/<strong>([^<]+)<\/strong> — 2/g)).toEqual([
        "<strong>Traces per hour</strong> — 2",
        "<strong>Spend per hour</strong> — 2",
        "<strong>Errors per hour</strong> — 2",
      ]);
    });
  });

  describe("given a report whose graph returns no data points for the window", () => {
    /** @scenario "A report whose source has no data still delivers" */
    it("delivers a message saying there was nothing to show", async () => {
      const mail = new FakeMailGateway();
      const trigger = makeTrigger({
        source: { kind: "customGraph", customGraphId: "graph-1" },
      });
      const deps = makeDeps({
        trigger,
        mail,
        loadReportCharts: chartReader({
          graphs: [graphRow()],
          timeseries: { previousPeriod: [], currentPeriod: [] },
        }),
      });

      await dispatchScheduledReport({ deps, fire: FIRE });

      expect(mail.emails).toHaveLength(1);
      expect(mail.emails[0]?.html).toContain("Nothing to show for this period");
      // Delivered, so the fire is recorded — an empty period is a report that
      // ran, not a report that failed.
      expect(deps.recordFire).toHaveBeenCalledWith({
        projectId: PROJECT.id,
        triggerId: "report-1",
        firedAt: SLOT,
      });
    });
  });
});
