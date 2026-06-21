import { AlertType, TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildGraphAlertTriggerData,
  graphAlertActionParamsSchema,
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
