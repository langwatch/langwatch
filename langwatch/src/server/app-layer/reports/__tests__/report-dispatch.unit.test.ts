import type { Project, Trigger } from "@prisma/client";
import { TriggerAction, TriggerKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ScheduledJobFire } from "~/server/app-layer/scheduler/scheduler.types";
import type {
  ReportChart,
  ReportTraceRow,
} from "~/shared/templating/templateContext";
import {
  dispatchScheduledReport,
  type ReportDispatchDeps,
} from "../report-dispatch";

const PROJECT: Project = {
  id: "proj-1",
  name: "Acme",
  slug: "acme",
} as unknown as Project;

function makeTraceRow(overrides: Partial<ReportTraceRow> = {}): ReportTraceRow {
  return {
    traceId: "trace-abc",
    url: "https://app.langwatch.ai/acme/messages/trace-abc",
    timestamp: "2026-07-13T08:00:00.000Z",
    input: "first input",
    output: "first output",
    model: "gpt-5-mini",
    status: "error",
    costUsd: 0.0241,
    durationMs: 1834,
    ...overrides,
  };
}

function makeChart(overrides: Partial<ReportChart> = {}): ReportChart {
  return {
    id: "graph-9",
    title: "Errors per hour",
    type: "line",
    categories: ["09:00", "10:00"],
    series: [
      {
        name: "Errors",
        data: [
          { label: "09:00", value: 3 },
          { label: "10:00", value: 7 },
        ],
      },
    ],
    segments: [],
    total: 10,
    isEmpty: false,
    ...overrides,
  };
}

function makeReportTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: "trig-1",
    projectId: "proj-1",
    name: "Weekly errors",
    action: TriggerAction.SEND_SLACK_MESSAGE,
    triggerKind: TriggerKind.REPORT,
    active: true,
    deleted: false,
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    filterQuery: null,
    actionParams: {
      source: { kind: "traceQuery", filters: {}, topN: 5 },
      schedule: { cron: "0 9 * * 1", timezone: "UTC" },
      slackWebhook: "https://hooks.slack.com/services/x",
    },
    ...overrides,
  } as unknown as Trigger;
}

function makeDeps(
  trigger: Trigger | null,
  opts: { traces?: ReportTraceRow[]; charts?: ReportChart[] } = {},
): {
  deps: ReportDispatchDeps;
  sendEmail: ReturnType<typeof vi.fn>;
  sendSlack: ReturnType<typeof vi.fn>;
  sendSlackBot: ReturnType<typeof vi.fn>;
  listReportTraces: ReturnType<typeof vi.fn>;
  loadReportCharts: ReturnType<typeof vi.fn>;
} {
  const sendEmail = vi.fn(async () => undefined);
  const sendSlack = vi.fn(async () => undefined);
  const sendSlackBot = vi.fn(async () => undefined);
  const listReportTraces = vi.fn(async () => opts.traces ?? []);
  const loadReportCharts = vi.fn(async () => opts.charts ?? []);
  return {
    sendEmail,
    sendSlack,
    sendSlackBot,
    listReportTraces,
    loadReportCharts,
    deps: {
      loadTrigger: vi.fn(async () => trigger),
      loadProject: vi.fn(async () => PROJECT),
      sendEmail: sendEmail as unknown as ReportDispatchDeps["sendEmail"],
      sendSlack: sendSlack as unknown as ReportDispatchDeps["sendSlack"],
      sendSlackBot:
        sendSlackBot as unknown as ReportDispatchDeps["sendSlackBot"],
      filterSuppressedRecipients: vi.fn(async ({ emails }) => emails),
      listReportTraces:
        listReportTraces as unknown as ReportDispatchDeps["listReportTraces"],
      loadReportCharts:
        loadReportCharts as unknown as ReportDispatchDeps["loadReportCharts"],
      baseHost: "https://app.langwatch.ai",
    },
  };
}

const fire: ScheduledJobFire = {
  projectId: "proj-1",
  targetType: "reportTrigger",
  targetId: "trig-1",
  slot: new Date("2026-07-13T09:00:00.000Z"),
};

describe("dispatchScheduledReport", () => {
  describe("given a Slack report is due", () => {
    it("renders the report default and posts to the webhook with a view link", async () => {
      const { deps, sendSlack } = makeDeps(makeReportTrigger());
      await dispatchScheduledReport({ deps, fire });
      expect(sendSlack).toHaveBeenCalledTimes(1);
      const payload = JSON.stringify(sendSlack.mock.calls[0]![0].payload);
      expect(payload).toContain("Weekly errors");
      expect(payload).toContain("/acme/messages");
    });
  });

  describe("given an email report is due", () => {
    it("filters suppressed recipients then sends the rendered email", async () => {
      const { deps, sendEmail } = makeDeps(
        makeReportTrigger({
          action: TriggerAction.SEND_EMAIL,
          actionParams: {
            source: { kind: "customGraph", customGraphId: "graph-9" },
            schedule: { cron: "0 7 * * *", timezone: "UTC" },
            members: ["a@acme.test"],
          },
        } as Partial<Trigger>),
      );
      await dispatchScheduledReport({ deps, fire });
      expect(deps.filterSuppressedRecipients).toHaveBeenCalled();
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0]![0].subject).toContain("Weekly errors");
    });
  });

  describe("given a traceQuery report is due", () => {
    it("queries the schedule window and renders the matching traces into Slack", async () => {
      const { deps, sendSlack, listReportTraces } = makeDeps(
        makeReportTrigger(),
        {
          traces: [
            makeTraceRow(),
            makeTraceRow({ traceId: "trace-def", input: "second input" }),
          ],
        },
      );

      await dispatchScheduledReport({ deps, fire });

      expect(listReportTraces).toHaveBeenCalledTimes(1);
      const args = listReportTraces.mock.calls[0]![0];
      expect(args.projectId).toBe("proj-1");
      expect(args.limit).toBe(5);
      // Weekly cron "0 9 * * 1" → trailing 7-day window ending at the slot.
      const slot = fire.slot.getTime();
      expect(args.to).toBe(slot);
      expect(args.from).toBe(slot - 7 * 24 * 60 * 60 * 1000);

      const payload = JSON.stringify(sendSlack.mock.calls[0]![0].payload);
      expect(payload).toContain("trace-abc");
      expect(payload).toContain("first input");
      expect(payload).toContain("trace-def");
    });

    describe("when the author wrote a search query", () => {
      it("scopes the report to it, so 'top matching traces' actually matches", async () => {
        const { deps, listReportTraces } = makeDeps(
          makeReportTrigger({
            filterQuery: 'status:error AND model:"gpt-5-mini"',
          } as Partial<Trigger>),
        );

        await dispatchScheduledReport({ deps, fire });

        expect(listReportTraces.mock.calls[0]![0].query).toBe(
          'status:error AND model:"gpt-5-mini"',
        );
      });
    });

    describe("when the author wrote no query", () => {
      it("passes an empty query, meaning the whole window", async () => {
        const { deps, listReportTraces } = makeDeps(makeReportTrigger());
        await dispatchScheduledReport({ deps, fire });
        expect(listReportTraces.mock.calls[0]![0].query).toBe("");
      });
    });

    describe("when nothing matched", () => {
      it("still delivers, saying there was nothing to show", async () => {
        const { deps, sendSlack } = makeDeps(makeReportTrigger(), {
          traces: [],
        });
        await dispatchScheduledReport({ deps, fire });
        expect(sendSlack).toHaveBeenCalledTimes(1);
        const payload = JSON.stringify(sendSlack.mock.calls[0]![0].payload);
        expect(payload).toContain("Weekly errors");
      });
    });
  });

  describe("given a customGraph report is due", () => {
    it("loads the graph's charts instead of traces", async () => {
      const { deps, sendSlack, listReportTraces, loadReportCharts } = makeDeps(
        makeReportTrigger({
          slackTemplateType: "block_kit",
          actionParams: {
            source: { kind: "customGraph", customGraphId: "graph-9" },
            schedule: { cron: "0 7 * * *", timezone: "UTC" },
            slackWebhook: "https://hooks.slack.com/services/x",
          },
        } as Partial<Trigger>),
        { charts: [makeChart()] },
      );

      await dispatchScheduledReport({ deps, fire });

      expect(listReportTraces).not.toHaveBeenCalled();
      expect(loadReportCharts).toHaveBeenCalledTimes(1);
      expect(loadReportCharts.mock.calls[0]![0].source).toEqual({
        kind: "customGraph",
        customGraphId: "graph-9",
      });
      expect(sendSlack).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a dashboard report is due", () => {
    it("loads every panel on the dashboard", async () => {
      const { deps, loadReportCharts } = makeDeps(
        makeReportTrigger({
          actionParams: {
            source: { kind: "dashboard", dashboardId: "dash-1" },
            schedule: { cron: "0 7 * * *", timezone: "UTC" },
            slackWebhook: "https://hooks.slack.com/services/x",
          },
        } as Partial<Trigger>),
        { charts: [makeChart(), makeChart({ id: "graph-10" })] },
      );

      await dispatchScheduledReport({ deps, fire });

      expect(loadReportCharts.mock.calls[0]![0].source).toEqual({
        kind: "dashboard",
        dashboardId: "dash-1",
      });
    });
  });

  describe("given the trigger is inactive or gone", () => {
    it("skips without sending", async () => {
      const { deps, sendSlack } = makeDeps(
        makeReportTrigger({ active: false }),
      );
      await dispatchScheduledReport({ deps, fire });
      expect(sendSlack).not.toHaveBeenCalled();

      const missing = makeDeps(null);
      await dispatchScheduledReport({ deps: missing.deps, fire });
      expect(missing.sendSlack).not.toHaveBeenCalled();
    });
  });
});
