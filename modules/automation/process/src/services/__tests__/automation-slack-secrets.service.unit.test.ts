/** Slack params at rest and on read. @see specs/automations/slack-connections.feature */
import { describe, expect, it } from "vitest";

import { sealWith } from "../../__tests__/fixtures/trigger-secrets.fixture.ts";
import { readableSlackActionParams } from "../../rules/automation-slack-read.rules.ts";
import { AutomationSlackSecretsService } from "../automation-slack-secrets.service.ts";

// Built at runtime so no fixture reads as a real credential.
const BOT_TOKEN = ["xoxb", "fake", "token"].join("-");
const WEBHOOK_URL = ["https://hooks.slack.com", "services", "fake"].join("/");

const service = AutomationSlackSecretsService.create(
  sealWith({
    encrypt: (value) => `enc(${value})`,
    decrypt: (value) => value.replace(/^enc\(/, "").replace(/\)$/, ""),
  }),
);

describe("AutomationSlackSecretsService.persist", () => {
  describe("when the params point at a connection", () => {
    it("stores only the id, the method and a bot connection's channel", () => {
      const stored = service.persist({
        incoming: {
          slackIntegrationId: "conn-1",
          slackDelivery: "bot",
          slackChannelId: " C1 ",
          slackBotToken: BOT_TOKEN,
          slackWebhook: WEBHOOK_URL,
        },
      });

      expect(stored).toEqual({
        slackIntegrationId: "conn-1",
        slackDelivery: "bot",
        slackChannelId: "C1",
      });
    });
  });

  describe("when the params name no connection", () => {
    /** @scenario "A save with no connection stores no secret" */
    /** @scenario "The bot token is protected at rest" */
    it("keeps no bot token, webhook URL or token-set flag", () => {
      for (const incoming of [
        { slackDelivery: "bot" as const, slackChannelId: "C1", slackBotToken: BOT_TOKEN },
        { slackDelivery: "webhook" as const, slackWebhook: WEBHOOK_URL },
        { slackDelivery: "bot" as const, slackChannelId: "C1", slackBotTokenSet: true },
      ]) {
        const stored = service.persist({ incoming });

        expect(stored).not.toHaveProperty("slackBotToken");
        expect(stored).not.toHaveProperty("slackWebhook");
        expect(stored).not.toHaveProperty("slackBotTokenSet");
      }
    });
  });
});

describe("readableSlackActionParams", () => {
  /** @scenario "Reading an automation returns only its connection, method and channel" */
  /** @scenario "The bot token is protected at rest" */
  it("returns only the connection, method and channel of a row not yet migrated", () => {
    const read = readableSlackActionParams({
      slackIntegrationId: "conn-1",
      slackDelivery: "bot",
      slackChannelId: "C1",
      slackBotToken: `enc(${BOT_TOKEN})`,
      slackWebhook: WEBHOOK_URL,
      slackBotTokenSet: true,
    });

    expect(read).toEqual({
      slackIntegrationId: "conn-1",
      slackDelivery: "bot",
      slackChannelId: "C1",
    });
    expect(JSON.stringify(read)).not.toContain("fake");
  });

  /** @scenario "Reading an automation returns only its connection, method and channel" */
  it("returns the rule a graph alert or report fires by as stored", () => {
    const rule = { threshold: 3, operator: "gt", timePeriod: 60 };

    expect(
      readableSlackActionParams({ ...rule, slackDelivery: "webhook", slackWebhook: WEBHOOK_URL }),
    ).toEqual({ ...rule, slackDelivery: "webhook" });
  });

  it("reads a legacy row saved before the delivery method existed as a webhook", () => {
    expect(readableSlackActionParams({ slackWebhook: WEBHOOK_URL })).toEqual({
      slackDelivery: "webhook",
    });
  });

  it("returns nothing for params that are not an object", () => {
    expect(readableSlackActionParams(null)).toEqual({});
  });
});

describe("AutomationSlackSecretsService.findDecryptedToken", () => {
  it("decrypts the stored token", () => {
    expect(service.findDecryptedToken({ slackBotToken: `enc(${BOT_TOKEN})` })).toBe(BOT_TOKEN);
  });

  it("returns nothing when no token is stored", () => {
    expect(service.findDecryptedToken({})).toBeNull();
  });
});
