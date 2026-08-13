import { describe, expect, it, vi } from "vitest";

// Fake cipher: what this file pins is which SURFACE a saved automation
// test-fires through, not how the token is protected.
vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

import type { Trigger } from "@prisma/client";
import { TriggerAction, TriggerKind } from "@prisma/client";
import type { PublicApiTestFireInput } from "../public-api-trigger.service";
import { PublicApiTriggerService } from "../public-api-trigger.service";
import type { TriggerService } from "../trigger.service";

/**
 * A test fire must reach the destination the automation is configured with —
 * and since ADR-093 §5 that is no longer decided by "does a token exist". The
 * project integration resolves a token for EVERY Slack row in a connected
 * project, so a webhook automation had one too, and the bot branch's
 * `token && channel` test would have taken it: the test fire would have posted
 * through the Web API, with the project's credential, on behalf of an
 * automation that delivers by webhook and has nothing to do with either.
 */

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

function makeService(trigger: Trigger) {
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
      // A connected project: the integration resolves a token for any row.
      resolveSlackToken: async () => ({
        token: "xoxb-project",
        source: "project_integration" as const,
      }),
    } as never,
  );
  return { service, testFire };
}

const fire = (service: PublicApiTriggerService) =>
  service.testFire({ projectId: "project-1", triggerId: "automation-1" });

describe("PublicApiTriggerService.testFire", () => {
  describe("given a Slack automation that delivers by webhook", () => {
    it("fires through its webhook, never the bot API the project's token opens", async () => {
      const { service, testFire } = makeService(
        savedTrigger({
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/services/T000/B000/xyz",
        }),
      );

      await fire(service);

      expect(testFire).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "slack",
          webhook: "https://hooks.slack.com/services/T000/B000/xyz",
        }),
      );
      expect(testFire.mock.calls[0]![0]).not.toHaveProperty("botDestination");
    });

    it("fires through its webhook even when it carries a stale bot channel", async () => {
      const { service, testFire } = makeService(
        savedTrigger({
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/services/T000/B000/xyz",
          slackChannelId: "C0123",
        }),
      );

      await fire(service);

      expect(testFire.mock.calls[0]![0]).not.toHaveProperty("botDestination");
    });
  });

  describe("given a Slack automation that delivers as the bot", () => {
    it("fires through the Web API with the resolved token and its channel", async () => {
      const { service, testFire } = makeService(
        savedTrigger({ slackDelivery: "bot", slackChannelId: "C0123" }),
      );

      await fire(service);

      expect(testFire).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "slack",
          botDestination: { token: "xoxb-project", channel: "C0123" },
        }),
      );
    });
  });
});
