import { AlertType, TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildGraphAlertTriggerData,
  extractGraphAlertFromTriggerRow,
  graphAlertActionParamsSchema,
  GRAPH_ALERT_OPERATORS,
  GRAPH_ALERT_TIME_PERIODS,
} from "../graph-alert.builder";

describe("buildGraphAlertTriggerData", () => {
  describe("given a Slack-channel graph alert input", () => {
    describe("when building the trigger data", () => {
      it("produces the row shape the dispatcher reads", () => {
        const data = buildGraphAlertTriggerData({
          id: "trigger-abc",
          name: "p95 latency",
          projectId: "project-1",
          action: TriggerAction.SEND_SLACK_MESSAGE,
          alertType: AlertType.WARNING,
          customGraphId: "graph-1",
          actionParams: {
            threshold: 250,
            operator: "gt",
            timePeriod: 60,
            seriesName: "0/latency/p95",
            slackWebhook: "https://hooks.slack.com/services/abc",
          },
        });

        expect(data).toEqual({
          id: "trigger-abc",
          name: "Alert: p95 latency",
          projectId: "project-1",
          action: TriggerAction.SEND_SLACK_MESSAGE,
          actionParams: {
            threshold: 250,
            operator: "gt",
            timePeriod: 60,
            seriesName: "0/latency/p95",
            slackWebhook: "https://hooks.slack.com/services/abc",
          },
          filters: {},
          alertType: AlertType.WARNING,
          active: true,
          customGraphId: "graph-1",
        });
      });

      it("does not double-prefix a name already prefixed with Alert:", () => {
        const data = buildGraphAlertTriggerData({
          id: "trigger-abc",
          name: "Alert: p95 latency",
          projectId: "project-1",
          action: TriggerAction.SEND_SLACK_MESSAGE,
          alertType: AlertType.WARNING,
          customGraphId: "graph-1",
          actionParams: {
            threshold: 250,
            operator: "gt",
            timePeriod: 60,
            seriesName: "0/latency/p95",
            slackWebhook: "https://hooks.slack.com/services/abc",
          },
        });

        expect(data.name).toBe("Alert: p95 latency");
      });

      it("strips lower-case 'alert:' prefix before applying canonical form (builder5015-009)", () => {
        const data = buildGraphAlertTriggerData({
          id: "trigger-abc",
          name: "alert: cost spike",
          projectId: "project-1",
          action: TriggerAction.SEND_EMAIL,
          alertType: AlertType.INFO,
          customGraphId: "graph-1",
          actionParams: {
            threshold: 1,
            operator: "gt",
            timePeriod: 5,
            seriesName: "0/cost/sum",
            members: ["a@b.co"],
          },
        });
        expect(data.name).toBe("Alert: cost spike");
      });
    });
  });

  describe("given an email-channel graph alert input", () => {
    describe("when building the trigger data", () => {
      it("carries members through actionParams", () => {
        const data = buildGraphAlertTriggerData({
          id: "trigger-abc",
          name: "Cost spike",
          projectId: "project-1",
          action: TriggerAction.SEND_EMAIL,
          alertType: AlertType.CRITICAL,
          customGraphId: "graph-2",
          actionParams: {
            threshold: 1000,
            operator: "gte",
            timePeriod: 1440,
            seriesName: "0/cost/sum",
            members: ["alice@example.com", "bob@example.com"],
          },
        });

        expect(data.actionParams).toMatchObject({
          members: ["alice@example.com", "bob@example.com"],
          threshold: 1000,
          operator: "gte",
          timePeriod: 1440,
          seriesName: "0/cost/sum",
        });
        expect(data.action).toBe(TriggerAction.SEND_EMAIL);
        expect(data.alertType).toBe(AlertType.CRITICAL);
      });
    });
  });
});

describe("graphAlertActionParamsSchema", () => {
  describe("given a valid input", () => {
    describe("when parsed", () => {
      it("accepts the well-formed shape", () => {
        const result = graphAlertActionParamsSchema.safeParse({
          threshold: 0.5,
          operator: "lt",
          timePeriod: 5,
          seriesName: "errors",
        });

        expect(result.success).toBe(true);
      });
    });
  });

  describe("given an unknown operator", () => {
    describe("when parsed", () => {
      it("rejects the input", () => {
        const result = graphAlertActionParamsSchema.safeParse({
          threshold: 0.5,
          operator: "between",
          timePeriod: 5,
          seriesName: "errors",
        });

        expect(result.success).toBe(false);
      });
    });
  });

  describe("given an out-of-window timePeriod", () => {
    describe("when parsed", () => {
      it("rejects the input", () => {
        const result = graphAlertActionParamsSchema.safeParse({
          threshold: 0.5,
          operator: "gt",
          timePeriod: 7,
          seriesName: "errors",
        });

        expect(result.success).toBe(false);
      });
    });
  });

  describe("given a non-finite threshold", () => {
    describe("when parsed", () => {
      it("rejects the input", () => {
        const result = graphAlertActionParamsSchema.safeParse({
          threshold: Number.POSITIVE_INFINITY,
          operator: "gt",
          timePeriod: 60,
          seriesName: "errors",
        });

        expect(result.success).toBe(false);
      });
    });
  });

  describe("given an empty seriesName", () => {
    describe("when parsed", () => {
      it("rejects the input with a friendly message", () => {
        const result = graphAlertActionParamsSchema.safeParse({
          threshold: 0.5,
          operator: "gt",
          timePeriod: 60,
          seriesName: "",
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.errors[0]?.message).toMatch(/series/i);
        }
      });
    });
  });
});

describe("extractGraphAlertFromTriggerRow (builder5015-004)", () => {
  describe("given a valid persisted actionParams shape", () => {
    it("returns the parsed threshold rule plus preserved destination keys", () => {
      const parsed = extractGraphAlertFromTriggerRow({
        threshold: 250,
        operator: "gt",
        timePeriod: 60,
        seriesName: "0/latency/p95",
        slackWebhook: "https://hooks.slack.com/services/abc",
      });
      expect(parsed).toEqual({
        threshold: 250,
        operator: "gt",
        timePeriod: 60,
        seriesName: "0/latency/p95",
        slackWebhook: "https://hooks.slack.com/services/abc",
      });
    });
  });

  describe("given an actionParams with members[]", () => {
    it("preserves the members array alongside the parsed rule", () => {
      const parsed = extractGraphAlertFromTriggerRow({
        threshold: 1000,
        operator: "gte",
        timePeriod: 1440,
        seriesName: "0/cost/sum",
        members: ["alice@example.com", "bob@example.com"],
      });
      expect(parsed?.members).toEqual([
        "alice@example.com",
        "bob@example.com",
      ]);
      expect(parsed?.threshold).toBe(1000);
    });
  });

  describe("given null / non-object / malformed input", () => {
    it("returns null instead of throwing", () => {
      expect(extractGraphAlertFromTriggerRow(null)).toBeNull();
      expect(extractGraphAlertFromTriggerRow(undefined)).toBeNull();
      expect(extractGraphAlertFromTriggerRow("not-json")).toBeNull();
      expect(extractGraphAlertFromTriggerRow(42)).toBeNull();
      expect(extractGraphAlertFromTriggerRow({})).toBeNull();
      expect(
        extractGraphAlertFromTriggerRow({
          threshold: 1,
          operator: "between",
          timePeriod: 60,
          seriesName: "foo",
        }),
      ).toBeNull();
    });
  });

  describe("given an out-of-window timePeriod", () => {
    it("returns null (matches the writer's schema)", () => {
      expect(
        extractGraphAlertFromTriggerRow({
          threshold: 1,
          operator: "gt",
          timePeriod: 7,
          seriesName: "foo",
        }),
      ).toBeNull();
    });
  });

  describe("round-trip", () => {
    it.each(
      GRAPH_ALERT_OPERATORS.flatMap((operator) =>
        GRAPH_ALERT_TIME_PERIODS.map(
          (timePeriod) => [operator, timePeriod] as const,
        ),
      ),
    )(
      "build then extract yields the same threshold rule (operator=%s, timePeriod=%d)",
      (operator, timePeriod) => {
        const data = buildGraphAlertTriggerData({
          id: "t-1",
          name: "test",
          projectId: "p",
          action: TriggerAction.SEND_EMAIL,
          alertType: AlertType.INFO,
          customGraphId: "g",
          actionParams: {
            threshold: 42,
            operator,
            timePeriod,
            seriesName: "0/metric/sum",
            members: ["a@b.co"],
          },
        });
        const extracted = extractGraphAlertFromTriggerRow(data.actionParams);
        expect(extracted).toMatchObject({
          threshold: 42,
          operator,
          timePeriod,
          seriesName: "0/metric/sum",
          members: ["a@b.co"],
        });
      },
    );
  });
});
