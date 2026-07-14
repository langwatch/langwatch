import { TriggerAction, TriggerKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildReportTriggerData,
  extractReportFromTriggerRow,
  reportScheduleSchema,
  reportSourceSchema,
  type ReportActionParams,
} from "../report.builder";

const traceQueryParams: ReportActionParams = {
  source: { kind: "traceQuery", filters: { "traces.error": ["true"] }, topN: 5 },
  schedule: { cron: "0 9 * * 1", timezone: "Europe/Amsterdam" },
  compareToPrevious: false,
};

describe("buildReportTriggerData", () => {
  describe("given a trace-query report", () => {
    it("marks the row REPORT, forces empty filters, and keeps the source+schedule", () => {
      const data = buildReportTriggerData({
        id: "trigger-1",
        name: "  Weekly errors  ",
        projectId: "project-1",
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          ...traceQueryParams,
          slackWebhook: "https://hooks.slack.com/services/x",
        },
      });

      expect(data.triggerKind).toBe(TriggerKind.REPORT);
      expect(data.name).toBe("Weekly errors");
      expect(data.filters).toEqual({});
      expect(data.active).toBe(true);
      expect((data.actionParams as { source: { kind: string } }).source.kind).toBe(
        "traceQuery",
      );
      expect(
        (data.actionParams as { slackWebhook: string }).slackWebhook,
      ).toBe("https://hooks.slack.com/services/x");
    });
  });
});

describe("reportScheduleSchema", () => {
  const issuePaths = (cron: string, timezone: string): string[] => {
    const parsed = reportScheduleSchema.safeParse({ cron, timezone });
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => issue.path.join("."));
  };

  describe("given a schedule the scheduler can actually run", () => {
    it.each([
      { cron: "0 9 * * 1", timezone: "Europe/Amsterdam" },
      { cron: "0 7 * * *", timezone: "UTC" },
      { cron: "0 9 1 * *", timezone: "America/New_York" },
      { cron: "0 */6 * * *", timezone: "UTC" },
      { cron: "*/15 * * * *", timezone: "UTC" },
    ])("accepts $cron ($timezone)", ({ cron, timezone }) => {
      expect(reportScheduleSchema.safeParse({ cron, timezone }).success).toBe(
        true,
      );
    });
  });

  describe("given a cron the scheduler would choke on", () => {
    it("rejects it here, before an active report row is ever written", () => {
      // Previously these sailed through the router and only blew up inside
      // computeNextRunAt — after the active Trigger row was committed, leaving
      // a report that shows as live and can never fire.
      expect(issuePaths("not a cron", "UTC")).toEqual(["cron"]);
      expect(issuePaths("99 99 * * *", "UTC")).toEqual(["cron"]);
      // Parses, but there is no February 30th — it would never come due.
      expect(issuePaths("0 9 30 2 *", "UTC")).toEqual(["cron"]);
    });
  });

  describe("given a seconds-granularity cron", () => {
    it("rejects the 6-field form croner would otherwise happily run every second", () => {
      expect(issuePaths("* * * * * *", "UTC")).toEqual(["cron"]);
      expect(issuePaths("0 0 9 * * 1", "UTC")).toEqual(["cron"]);
    });
  });

  describe("given a schedule that sends more often than every 15 minutes", () => {
    it("rejects it — a report mails a document to an arbitrary recipient list", () => {
      expect(issuePaths("* * * * *", "UTC")).toEqual(["cron"]);
      expect(issuePaths("*/5 * * * *", "UTC")).toEqual(["cron"]);
      expect(issuePaths("0,1 9 * * *", "UTC")).toEqual(["cron"]);
    });
  });

  describe("given a timezone Intl has never heard of", () => {
    it("rejects it against the timezone field, not the cron", () => {
      expect(issuePaths("0 9 * * 1", "Mars/Olympus")).toEqual(["timezone"]);
    });
  });
});

describe("reportSourceSchema", () => {
  describe("when discriminating the source kind", () => {
    it("accepts dashboard, customGraph, and traceQuery, and rejects unknown", () => {
      expect(
        reportSourceSchema.safeParse({ kind: "dashboard", dashboardId: "d1" })
          .success,
      ).toBe(true);
      expect(
        reportSourceSchema.safeParse({
          kind: "customGraph",
          customGraphId: "g1",
        }).success,
      ).toBe(true);
      expect(
        reportSourceSchema.safeParse({ kind: "traceQuery" }).success,
      ).toBe(true); // filters/topN default
      expect(
        reportSourceSchema.safeParse({ kind: "spreadsheet" }).success,
      ).toBe(false);
    });

    it("defaults trace-query topN to 5 and filters to empty", () => {
      const parsed = reportSourceSchema.parse({ kind: "traceQuery" });
      expect(parsed).toEqual({ kind: "traceQuery", filters: {}, topN: 5 });
    });
  });
});

describe("extractReportFromTriggerRow", () => {
  describe("given a report-shaped actionParams", () => {
    it("round-trips the source+schedule and preserves destination keys", () => {
      const row = { ...traceQueryParams, members: ["a@b.co"] };
      const out = extractReportFromTriggerRow(row);
      expect(out?.source.kind).toBe("traceQuery");
      expect(out?.schedule.cron).toBe("0 9 * * 1");
      expect((out as unknown as { members: string[] }).members).toEqual([
        "a@b.co",
      ]);
    });
  });

  describe("given a non-report actionParams", () => {
    it("returns null", () => {
      expect(extractReportFromTriggerRow({ threshold: 10 })).toBeNull();
      expect(extractReportFromTriggerRow(null)).toBeNull();
    });
  });
});
