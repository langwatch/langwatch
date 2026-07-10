import { TriggerAction, TriggerKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildReportTriggerData,
  extractReportFromTriggerRow,
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
      expect((out as { members: string[] }).members).toEqual(["a@b.co"]);
    });
  });

  describe("given a non-report actionParams", () => {
    it("returns null", () => {
      expect(extractReportFromTriggerRow({ threshold: 10 })).toBeNull();
      expect(extractReportFromTriggerRow(null)).toBeNull();
    });
  });
});
