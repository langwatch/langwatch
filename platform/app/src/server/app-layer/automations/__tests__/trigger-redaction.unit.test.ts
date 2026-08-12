import { TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  REDACTED_CREDENTIAL,
  redactTriggerForPublicApi,
  redactTriggerForRead,
  resolveRedactedCredentials,
} from "../trigger-redaction";

const SLACK_WEBHOOK =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX";
const HEADER_VALUE = "Bearer sk-live-abcdefghijklmnop";

describe("redactTriggerForPublicApi", () => {
  describe("given a Slack automation", () => {
    it("replaces the incoming webhook URL with the placeholder", () => {
      const redacted = redactTriggerForPublicApi({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: { slackDelivery: "webhook", slackWebhook: SLACK_WEBHOOK },
      });

      expect(redacted.actionParams).toEqual({
        slackDelivery: "webhook",
        slackWebhook: REDACTED_CREDENTIAL,
      });
      expect(JSON.stringify(redacted)).not.toContain("hooks.slack.com");
    });

    it("keeps the stored bot token out and reports that one is set", () => {
      const redacted = redactTriggerForPublicApi({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "bot",
          slackChannelId: "C123",
          slackBotToken: "abc:def:ghi",
        },
      });

      expect(redacted.actionParams).toEqual({
        slackDelivery: "bot",
        slackChannelId: "C123",
        slackBotTokenSet: true,
      });
    });
  });

  describe("given a webhook automation with a stored header", () => {
    /** @scenario "The delivery shape survives redaction" */
    it("keeps the destination and header name, and hides the value", () => {
      const redacted = redactTriggerForPublicApi({
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: {
          url: "https://example.com/hooks/langwatch",
          method: "POST",
          headers: { Authorization: HEADER_VALUE },
        },
      });

      expect(redacted.actionParams).toMatchObject({
        url: "https://example.com/hooks/langwatch",
        method: "POST",
        headers: { Authorization: REDACTED_CREDENTIAL },
      });
      expect(JSON.stringify(redacted)).not.toContain("sk-live");
    });

    it("reports an unsigned automation as unsigned rather than as a secret", () => {
      const redacted = redactTriggerForPublicApi({
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: {
          url: "https://example.com/hooks/langwatch",
          headers: {},
        },
      });

      expect(
        (redacted.actionParams as { signingSecret: unknown }).signingSecret,
      ).toBeNull();
    });
  });

  describe("given an automation whose delivery carries no credential", () => {
    it("returns the delivery configuration unchanged", () => {
      const actionParams = { datasetId: "dataset_1" };

      expect(
        redactTriggerForPublicApi({
          action: TriggerAction.ADD_TO_DATASET,
          actionParams,
        }).actionParams,
      ).toEqual(actionParams);
    });
  });

  describe("given a stored row naming a channel this server does not offer", () => {
    /** @scenario "A delivery channel the server no longer offers returns nothing" */
    it("returns an empty delivery configuration", () => {
      const redacted = redactTriggerForPublicApi({
        action: "SEND_CARRIER_PIGEON" as TriggerAction,
        actionParams: { pigeonWebhook: SLACK_WEBHOOK },
      });

      expect(redacted.actionParams).toEqual({});
    });
  });

  describe("given the stored row", () => {
    it("leaves it untouched", () => {
      const actionParams = { slackWebhook: SLACK_WEBHOOK };

      redactTriggerForPublicApi({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams,
      });

      expect(actionParams.slackWebhook).toBe(SLACK_WEBHOOK);
    });
  });
});

describe("redactTriggerForRead", () => {
  describe("given a Slack automation the dashboard is about to edit", () => {
    it("keeps the fields the composer round-trips and drops the token", () => {
      const redacted = redactTriggerForRead({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: { slackWebhook: SLACK_WEBHOOK, slackBotToken: "cipher" },
      });

      expect(redacted.actionParams).toEqual({
        slackWebhook: SLACK_WEBHOOK,
        slackBotTokenSet: true,
      });
    });
  });
});

describe("resolveRedactedCredentials", () => {
  describe("given a placeholder for a field that is already stored", () => {
    it("keeps the stored value", () => {
      const resolved = resolveRedactedCredentials({
        incoming: {
          slackWebhook: REDACTED_CREDENTIAL,
          slackDelivery: "webhook",
        },
        stored: { slackWebhook: SLACK_WEBHOOK, slackDelivery: "webhook" },
      });

      expect(resolved).toEqual({
        slackWebhook: SLACK_WEBHOOK,
        slackDelivery: "webhook",
      });
    });

    it("resolves it inside a nested record too", () => {
      const resolved = resolveRedactedCredentials({
        incoming: { headers: { Authorization: REDACTED_CREDENTIAL } },
        stored: { headers: { Authorization: HEADER_VALUE } },
      });

      expect(resolved).toEqual({ headers: { Authorization: HEADER_VALUE } });
    });
  });

  describe("given a placeholder for a field with nothing stored behind it", () => {
    it("drops the field rather than saving the placeholder", () => {
      const resolved = resolveRedactedCredentials({
        incoming: {
          slackWebhook: REDACTED_CREDENTIAL,
          slackDelivery: "webhook",
        },
        stored: {},
      });

      expect(resolved).toEqual({ slackDelivery: "webhook" });
    });
  });

  describe("given a real value", () => {
    it("takes the value the caller sent", () => {
      const resolved = resolveRedactedCredentials({
        incoming: { slackWebhook: SLACK_WEBHOOK },
        stored: { slackWebhook: "https://hooks.slack.com/services/OLD" },
      });

      expect(resolved).toEqual({ slackWebhook: SLACK_WEBHOOK });
    });
  });
});
