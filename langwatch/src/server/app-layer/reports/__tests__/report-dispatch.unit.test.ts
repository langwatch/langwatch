import type { Project, Trigger } from "@prisma/client";
import { TriggerAction, TriggerKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ScheduledJobFire } from "~/server/app-layer/scheduler/scheduler.types";
import {
  dispatchScheduledReport,
  type ReportDispatchDeps,
} from "../report-dispatch";

const PROJECT: Project = {
  id: "proj-1",
  name: "Acme",
  slug: "acme",
} as unknown as Project;

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
  opts: { rows?: string[] } = {},
): {
  deps: ReportDispatchDeps;
  sendEmail: ReturnType<typeof vi.fn>;
  sendSlack: ReturnType<typeof vi.fn>;
  listTraceRows: ReturnType<typeof vi.fn>;
} {
  const sendEmail = vi.fn(async () => undefined);
  const sendSlack = vi.fn(async () => undefined);
  const listTraceRows = vi.fn(async () => opts.rows ?? []);
  return {
    sendEmail,
    sendSlack,
    listTraceRows,
    deps: {
      loadTrigger: vi.fn(async () => trigger),
      loadProject: vi.fn(async () => PROJECT),
      sendEmail: sendEmail as unknown as ReportDispatchDeps["sendEmail"],
      sendSlack: sendSlack as unknown as ReportDispatchDeps["sendSlack"],
      filterSuppressedRecipients: vi.fn(async ({ emails }) => emails),
      listTraceRows:
        listTraceRows as unknown as ReportDispatchDeps["listTraceRows"],
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
    it("queries the schedule window and renders the returned rows into Slack", async () => {
      const { deps, sendSlack, listTraceRows } = makeDeps(
        makeReportTrigger(),
        { rows: ["trace-abc — first input", "trace-def — second input"] },
      );

      await dispatchScheduledReport({ deps, fire });

      expect(listTraceRows).toHaveBeenCalledTimes(1);
      const args = listTraceRows.mock.calls[0]![0];
      expect(args.projectId).toBe("proj-1");
      expect(args.filters).toEqual({});
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
  });

  describe("given a customGraph report is due", () => {
    it("sends without querying trace rows and renders no row lines", async () => {
      const { deps, sendSlack, listTraceRows } = makeDeps(
        makeReportTrigger({
          actionParams: {
            source: { kind: "customGraph", customGraphId: "graph-9" },
            schedule: { cron: "0 7 * * *", timezone: "UTC" },
            slackWebhook: "https://hooks.slack.com/services/x",
          },
        } as Partial<Trigger>),
      );

      await dispatchScheduledReport({ deps, fire });

      expect(listTraceRows).not.toHaveBeenCalled();
      expect(sendSlack).toHaveBeenCalledTimes(1);
      const payload = JSON.stringify(sendSlack.mock.calls[0]![0].payload);
      // The row bullet ("•") only appears when rows are present.
      expect(payload).not.toContain("•");
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
