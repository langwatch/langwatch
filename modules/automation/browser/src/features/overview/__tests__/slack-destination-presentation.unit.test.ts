import { describe, expect, it } from "vitest";

import {
  slackDestinationLabel,
  slackDestinationPresentation,
} from "../model/slack-destination-presentation.ts";

/**
 * The list page and the view drawer both name a Slack automation's destination through this one
 * decision.
 */
const connections = [
  { id: "conn-bot", name: "Alerts bot" },
  { id: "conn-hook", name: "Ops webhook" },
];

describe("given a Slack automation that delivers through a connection", () => {
  describe("when the connection is a bot with a channel", () => {
    it("names the connection and the channel", () => {
      const result = slackDestinationPresentation({
        actionParams: {
          slackIntegrationId: "conn-bot",
          slackDelivery: "bot",
          slackChannelId: "C0123456",
        },
        connections,
      });

      expect(result).toEqual({ kind: "bot", connectionName: "Alerts bot", channelId: "C0123456" });
      expect(slackDestinationLabel(result)).toBe("Alerts bot · channel C0123456");
    });
  });

  describe("when the connection is a webhook", () => {
    it("names the connection and offers no URL", () => {
      const result = slackDestinationPresentation({
        actionParams: { slackIntegrationId: "conn-hook", slackDelivery: "webhook" },
        connections,
      });

      expect(result).toEqual({ kind: "webhook", connectionName: "Ops webhook", tooltipUrl: null });
      expect(slackDestinationLabel(result)).toBe("Ops webhook");
    });
  });

  describe("when the connection is not among those the project can use", () => {
    it("falls back to the delivery kind", () => {
      const result = slackDestinationPresentation({
        actionParams: { slackIntegrationId: "gone", slackDelivery: "bot" },
        connections,
      });

      expect(result).toEqual({ kind: "bot", connectionName: null, channelId: null });
      expect(slackDestinationLabel(result)).toBe("Slack app");
    });
  });
});

describe("given a Slack automation still on its own secret", () => {
  describe("when the stored value is a real Slack webhook URL", () => {
    it("carries the URL as safe to show on hover", () => {
      const result = slackDestinationPresentation({
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/services/abc",
        },
        connections,
      });

      expect(result).toEqual({
        kind: "webhook",
        connectionName: null,
        tooltipUrl: "https://hooks.slack.com/services/abc",
      });
      expect(slackDestinationLabel(result)).toBe("Slack webhook");
    });
  });

  describe("when the row predates delivery method (no slackDelivery key)", () => {
    it("falls back to webhook delivery", () => {
      const result = slackDestinationPresentation({
        actionParams: { slackWebhook: "https://hooks.slack.com/services/legacy" },
        connections: undefined,
      });

      expect(result).toMatchObject({
        kind: "webhook",
        tooltipUrl: "https://hooks.slack.com/services/legacy",
      });
    });
  });

  describe("when the stored value is not a real URL", () => {
    it("does not surface a placeholder as a hoverable webhook", () => {
      for (const slackWebhook of ["[redacted]", "https://", undefined]) {
        expect(
          slackDestinationPresentation({
            actionParams: { slackDelivery: "webhook", slackWebhook },
            connections,
          }),
        ).toMatchObject({ kind: "webhook", tooltipUrl: null });
      }
    });
  });
});
