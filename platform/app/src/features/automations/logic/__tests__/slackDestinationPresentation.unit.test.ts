import { describe, expect, it } from "vitest";
import { slackDestinationPresentation } from "../slackDestinationPresentation";

/**
 * #6244: the list page and the view drawer each independently rendered
 * every Slack automation as though it were a webhook, including bot-token
 * deliveries that never carry one. This is the single decision both
 * surfaces now import.
 */
describe("given a bot-delivery Slack automation", () => {
  describe("when a destination channel has been chosen", () => {
    it("names the delivery as bot and carries the channel id", () => {
      const result = slackDestinationPresentation({
        slackDelivery: "bot",
        slackChannelId: "C0123456",
      });

      expect(result).toEqual({ kind: "bot", channelId: "C0123456" });
    });
  });

  describe("when no destination channel has been chosen yet", () => {
    it("names the delivery as bot without inventing a channel", () => {
      const result = slackDestinationPresentation({ slackDelivery: "bot" });

      expect(result).toEqual({ kind: "bot", channelId: null });
    });
  });
});

describe("given a webhook-delivery Slack automation", () => {
  describe("when the stored value is a real Slack webhook URL", () => {
    it("carries the URL as safe to show on hover", () => {
      const result = slackDestinationPresentation({
        slackDelivery: "webhook",
        slackWebhook: "https://hooks.slack.com/services/abc",
      });

      expect(result).toEqual({
        kind: "webhook",
        tooltipUrl: "https://hooks.slack.com/services/abc",
      });
    });
  });

  describe("when the row predates delivery method (no slackDelivery key)", () => {
    it("falls back to webhook delivery", () => {
      const result = slackDestinationPresentation({
        slackWebhook: "https://hooks.slack.com/services/legacy",
      });

      expect(result).toEqual({
        kind: "webhook",
        tooltipUrl: "https://hooks.slack.com/services/legacy",
      });
    });
  });

  describe("when the stored value is not a real URL", () => {
    it("does not surface a placeholder as though it were a hoverable webhook", () => {
      const redacted = slackDestinationPresentation({
        slackDelivery: "webhook",
        slackWebhook: "[redacted]",
      });
      const absent = slackDestinationPresentation({ slackDelivery: "webhook" });

      expect(redacted).toEqual({ kind: "webhook", tooltipUrl: null });
      expect(absent).toEqual({ kind: "webhook", tooltipUrl: null });
    });
  });

  describe("when the stored value wears the https prefix without being a URL", () => {
    it("offers no tooltip rather than showing a value that is not a URL", () => {
      expect(
        slackDestinationPresentation({
          slackDelivery: "webhook",
          slackWebhook: "https://",
        }),
      ).toEqual({ kind: "webhook", tooltipUrl: null });
    });
  });
});
