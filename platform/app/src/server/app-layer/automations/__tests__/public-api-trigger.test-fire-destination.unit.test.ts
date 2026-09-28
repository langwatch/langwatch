import { describe, expect, it, vi } from "vitest";

// Fake cipher: what this file pins is which SURFACE a saved automation
// test-fires through, not how the token is protected.
vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

import type { Trigger } from "~/generated/prisma/client";
import { TriggerAction, TriggerKind } from "~/generated/prisma/client";
import type { PublicApiTestFireInput } from "../public-api-trigger.service";
import { PublicApiTriggerService } from "../public-api-trigger.service";
import type { SlackConnectionSecret } from "../slack-integration/slack-destination-resolver";
import type { TriggerService } from "../trigger.service";

/**
 * A test fire must reach the destination a real delivery would (ADR-093 §5a):
 * the automation's connection decides the surface by its kind, whatever
 * `slackDelivery` the row happens to carry, and an automation with no
 * connection falls back to its own legacy secret.
 */

const CONNECTIONS: Record<string, SlackConnectionSecret> = {
  "conn-bot": { kind: "BOT", token: "xoxb-connection" },
  "conn-webhook": {
    kind: "INCOMING_WEBHOOK",
    url: "https://hooks.slack.com/services/T000/B000/connection",
  },
};

const savedTrigger = (actionParams: Record<string, unknown>): Trigger =>
  ({
    id: "automation-1",
    projectId: "project-1",
    name: "Error spike",
    action: TriggerAction.SEND_SLACK_MESSAGE,
    triggerKind: TriggerKind.AUTOMATION,
    actionParams,
    filters: {},
    filterQuery: null,
    deleted: false,
    active: true,
    alertType: null,
    message: null,
    customGraphId: null,
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
  }) as unknown as Trigger;

function makeService({
  trigger,
  connections = CONNECTIONS,
}: {
  trigger: Trigger;
  connections?: Record<string, SlackConnectionSecret>;
}) {
  const testFire = vi.fn(async (_input: PublicApiTestFireInput) => ({
    channel: "slack" as const,
    recipientCount: 0,
  }));
  const service = new PublicApiTriggerService(
    { getById: async () => trigger } as unknown as TriggerService,
    {
      graphs: {} as never,
      fireHistory: {} as never,
      testFire,
      resolveProject: async () => ({ name: "Project", slug: "project" }),
      slackConnections: {
        findUsableSecret: async ({ id }: { id: string }) =>
          connections[id] ?? null,
        connectActionParams: vi.fn(),
      },
    } as never,
  );
  return { service, testFire };
}

const fire = (service: PublicApiTriggerService) =>
  service.testFire({ projectId: "project-1", triggerId: "automation-1" });

describe("PublicApiTriggerService.testFire", () => {
  describe("given a Slack automation pointing at a webhook connection", () => {
    it("fires through the connection's webhook even when the row says bot", async () => {
      const { service, testFire } = makeService({
        trigger: savedTrigger({
          slackIntegrationId: "conn-webhook",
          slackDelivery: "bot",
          slackChannelId: "C0123",
        }),
      });

      await fire(service);

      expect(testFire).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "slack",
          webhook: "https://hooks.slack.com/services/T000/B000/connection",
        }),
      );
      expect(testFire.mock.calls[0]![0]).not.toHaveProperty("botDestination");
    });
  });

  describe("given a Slack automation pointing at a bot connection", () => {
    it("fires through the Web API with the connection's token and its channel", async () => {
      const { service, testFire } = makeService({
        trigger: savedTrigger({
          slackIntegrationId: "conn-bot",
          slackDelivery: "bot",
          slackChannelId: "C0123",
        }),
      });

      await fire(service);

      expect(testFire).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "slack",
          botDestination: { token: "xoxb-connection", channel: "C0123" },
        }),
      );
    });

    it("refuses when the bot connection has no channel to post to", async () => {
      const { service, testFire } = makeService({
        trigger: savedTrigger({ slackIntegrationId: "conn-bot" }),
      });

      await expect(fire(service)).rejects.toMatchObject({
        code: "test_fire_unavailable",
      });
      expect(testFire).not.toHaveBeenCalled();
    });
  });

  describe("given a connection the project can no longer use", () => {
    it("refuses, never falling back to a legacy webhook left on the row", async () => {
      const { service, testFire } = makeService({
        trigger: savedTrigger({
          slackIntegrationId: "conn-deleted",
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/services/T000/B000/stale",
        }),
      });

      await expect(fire(service)).rejects.toMatchObject({
        code: "test_fire_unavailable",
      });
      expect(testFire).not.toHaveBeenCalled();
    });
  });

  describe("given a legacy automation with its own webhook and no connection", () => {
    it("fires through its own webhook", async () => {
      const { service, testFire } = makeService({
        trigger: savedTrigger({
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/services/T000/B000/xyz",
        }),
      });

      await fire(service);

      expect(testFire).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "slack",
          webhook: "https://hooks.slack.com/services/T000/B000/xyz",
        }),
      );
    });
  });
});
