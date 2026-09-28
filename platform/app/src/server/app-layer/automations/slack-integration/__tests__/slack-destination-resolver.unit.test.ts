import { describe, expect, it, vi } from "vitest";

// Fake cipher: the resolution ORDER is what these tests pin, not AES.
vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

import {
  findSlackDestination,
  resolveSlackDestination,
  type SlackConnectionReader,
  type SlackConnectionSecret,
  slackConnectionMissingDispatchError,
} from "../slack-destination-resolver";

/** A reader holding connections usable by `project-1` only. */
const readerWith = (
  connections: Record<string, SlackConnectionSecret>,
): SlackConnectionReader => ({
  findUsableSecret: async ({ id, projectId }) =>
    projectId === "project-1" ? (connections[id] ?? null) : null,
});

const connections = readerWith({
  "conn-bot": { kind: "BOT", token: "xoxb-connection" },
  "conn-webhook": {
    kind: "INCOMING_WEBHOOK",
    url: "https://hooks.slack.com/services/T/B/connection",
  },
});

describe("findSlackDestination", () => {
  describe("given an automation pointing at a bot connection and a channel", () => {
    /** @scenario "An automation delivers through its connection" */
    it("posts with that connection's token to that channel", async () => {
      const destination = await findSlackDestination({
        actionParams: {
          slackIntegrationId: "conn-bot",
          slackDelivery: "bot",
          slackChannelId: "C0123",
        },
        projectId: "project-1",
        connections,
      });

      expect(destination).toEqual({
        kind: "bot",
        token: "xoxb-connection",
        channel: "C0123",
      });
    });
  });

  describe("given a stored delivery method that contradicts the connection's kind", () => {
    it("goes by the connection's kind", async () => {
      const destination = await findSlackDestination({
        actionParams: {
          slackIntegrationId: "conn-webhook",
          slackDelivery: "bot",
        },
        projectId: "project-1",
        connections,
      });

      expect(destination).toEqual({
        kind: "webhook",
        url: "https://hooks.slack.com/services/T/B/connection",
      });
    });
  });

  describe("given a connection that was deleted or belongs to another project", () => {
    /** @scenario "A connection outside the automation's reach fails with a named cause" */
    it("fails with the integration-missing code, never the legacy secret", async () => {
      const deleted = resolveSlackDestination({
        actionParams: {
          slackIntegrationId: "conn-gone",
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/services/T/B/legacy",
        },
        projectId: "project-1",
        connections,
      });
      const otherProject = resolveSlackDestination({
        actionParams: { slackIntegrationId: "conn-bot", slackChannelId: "C1" },
        projectId: "project-2",
        connections,
      });

      await expect(deleted).rejects.toMatchObject({
        code: "slack_integration_missing",
      });
      await expect(otherProject).rejects.toMatchObject({
        code: "slack_integration_missing",
      });
    });

    it("dead-letters at dispatch with the handled code as the cause", () => {
      const error = slackConnectionMissingDispatchError({
        triggerName: "Error spike",
      });

      expect(error.retryable).toBe(false);
      expect(error.cause).toMatchObject({ code: "slack_integration_missing" });
    });
  });

  describe("given an automation with no connection that stores its own secret", () => {
    /** @scenario "An automation not yet migrated keeps delivering with its own secret" */
    it("delivers with its own bot token or webhook URL", async () => {
      const bot = await findSlackDestination({
        actionParams: {
          slackDelivery: "bot",
          slackBotToken: "enc(xoxb-own)",
          slackChannelId: "C9",
        },
        projectId: "project-1",
        connections,
      });
      const webhook = await findSlackDestination({
        actionParams: {
          slackWebhook: "https://hooks.slack.com/services/T/B/own",
        },
        projectId: "project-1",
        connections,
      });

      expect(bot).toEqual({ kind: "bot", token: "xoxb-own", channel: "C9" });
      expect(webhook).toEqual({
        kind: "webhook",
        url: "https://hooks.slack.com/services/T/B/own",
      });
    });
  });

  describe("given an automation with neither a connection nor a secret", () => {
    it("resolves nothing", async () => {
      await expect(
        findSlackDestination({
          actionParams: { slackDelivery: "bot", slackChannelId: "C1" },
          projectId: "project-1",
          connections,
        }),
      ).resolves.toBeNull();
    });
  });
});
