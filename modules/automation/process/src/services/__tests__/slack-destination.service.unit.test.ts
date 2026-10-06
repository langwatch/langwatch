/** Where a Slack delivery goes. @see modules/slack/specs/slack-connections.feature */
import type { SlackConnectionSecret } from "@langwatch/slack-contract";
import { describe, expect, it } from "vitest";

import { sealWith } from "../../__tests__/fixtures/trigger-secrets.fixture.ts";
import { SlackDestinationService } from "../slack-destination.service.ts";

const PROJECT = "project-1";
const crypto = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
};

function serviceOver(connections: Record<string, SlackConnectionSecret>) {
  const reads: { id: string; projectId: string }[] = [];
  const slack = {
    findUsableSlackSecret: async (input: { id: string; projectId: string }) => {
      reads.push(input);
      const secret = connections[input.id];
      return secret ? [secret] : [];
    },
  };
  return { service: SlackDestinationService.create({ slack, triggers: sealWith(crypto) }), reads };
}

describe("SlackDestinationService", () => {
  describe("given an automation pointing at a bot connection and a channel", () => {
    /** @scenario "An automation delivers through its connection" */
    it("posts with that connection's token to that channel", async () => {
      const { service, reads } = serviceOver({ "conn-1": { kind: "BOT", token: "xoxb-1" } });

      const destination = await service.getSlackDestination({
        projectId: PROJECT,
        actionParams: {
          slackIntegrationId: "conn-1",
          slackDelivery: "bot",
          slackChannelId: " C1 ",
        },
      });

      expect(destination).toEqual({ kind: "bot", token: "xoxb-1", channel: "C1" });
      expect(reads).toEqual([{ id: "conn-1", projectId: PROJECT }]);
    });
  });

  describe("given a stored delivery method that contradicts the connection's kind", () => {
    it("goes by the connection's kind", async () => {
      const url = "https://hooks.slack.com/services/T/B/x";
      const { service } = serviceOver({ "conn-1": { kind: "INCOMING_WEBHOOK", url } });

      const destination = await service.getSlackDestination({
        projectId: PROJECT,
        actionParams: { slackIntegrationId: "conn-1", slackDelivery: "bot", slackChannelId: "C1" },
      });

      expect(destination).toEqual({ kind: "webhook", url });
    });
  });

  describe("given a connection that was deleted or belongs to another project", () => {
    /** @scenario "A connection outside the automation's reach fails with a named cause" */
    it("fails with the integration-missing code, never the legacy secret", async () => {
      const { service } = serviceOver({});

      await expect(
        service.getSlackDestination({
          projectId: PROJECT,
          actionParams: {
            slackIntegrationId: "gone",
            slackDelivery: "webhook",
            slackWebhook: "https://hooks.slack.com/services/T/B/legacy",
          },
        }),
      ).rejects.toMatchObject({ code: "slack_integration_missing" });
    });

    it("dead-letters at dispatch with the handled code as the cause", () => {
      const { service } = serviceOver({});
      const error = service.getMissingDispatchError({ triggerName: "Alert" });

      expect(error.retryable).toBe(false);
      expect(error.cause).toMatchObject({ code: "slack_integration_missing" });
    });
  });

  describe("given an automation with no connection that stores its own secret", () => {
    /** @scenario "An automation not yet migrated keeps delivering with its own secret" */
    it("delivers with its own bot token or webhook URL", async () => {
      const { service, reads } = serviceOver({});
      const url = "https://hooks.slack.com/services/T/B/own";

      const bot = await service.findSlackDestination({
        projectId: PROJECT,
        actionParams: { slackDelivery: "bot", slackBotToken: "enc:xoxb-own", slackChannelId: "C9" },
      });
      const webhook = await service.findSlackDestination({
        projectId: PROJECT,
        actionParams: { slackWebhook: url },
      });

      expect(bot).toEqual([{ kind: "bot", token: "xoxb-own", channel: "C9" }]);
      expect(webhook).toEqual([{ kind: "webhook", url }]);
      expect(reads).toEqual([]);
    });
  });

  describe("given an automation with neither a connection nor a secret", () => {
    it("resolves nothing", async () => {
      const { service } = serviceOver({});

      await expect(
        service.findSlackDestination({ projectId: PROJECT, actionParams: {} }),
      ).resolves.toEqual([]);
    });
  });
});
