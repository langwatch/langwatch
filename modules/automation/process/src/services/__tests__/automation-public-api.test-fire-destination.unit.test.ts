import { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import {
  createPublicApiRig,
  SECRETS,
  triggerRow,
} from "../../transport/__tests__/automation-rest-redaction.fixture.ts";

const slackRow = (actionParams: Record<string, unknown>) =>
  triggerRow({ id: "trigger_slack", action: TriggerAction.SEND_SLACK_MESSAGE, actionParams });

const fire = (rig: ReturnType<typeof createPublicApiRig>) =>
  rig.service.testFire({ projectId: "project_1", triggerId: "trigger_slack" });

describe("AutomationPublicApiService.testFire", () => {
  describe("given a Slack automation pointing at a webhook connection", () => {
    it("fires through the connection's webhook even when the row says bot", async () => {
      const rig = createPublicApiRig({
        rows: [
          slackRow({
            slackIntegrationId: "slackintegration_hook",
            slackDelivery: "bot",
            slackChannelId: "C1",
          }),
        ],
        connections: [
          {
            view: { id: "slackintegration_hook", kind: "INCOMING_WEBHOOK" },
            secret: { kind: "INCOMING_WEBHOOK", url: SECRETS.webhookUrl },
          },
        ],
      });
      await fire(rig);
      expect(rig.testFire).toHaveBeenCalledWith(
        expect.objectContaining({ webhook: SECRETS.webhookUrl, recipients: [] }),
      );
    });
  });

  describe("given a Slack automation pointing at a bot connection", () => {
    it("fires through the Web API with the connection's token and its channel", async () => {
      const rig = createPublicApiRig({
        rows: [
          slackRow({
            slackIntegrationId: "slackintegration_bot",
            slackDelivery: "bot",
            slackChannelId: "C1",
          }),
        ],
        connections: [
          {
            view: { id: "slackintegration_bot", kind: "BOT" },
            secret: { kind: "BOT", token: SECRETS.botToken },
          },
        ],
      });
      await fire(rig);
      expect(rig.testFire).toHaveBeenCalledWith(
        expect.objectContaining({ botDestination: { token: SECRETS.botToken, channel: "C1" } }),
      );
    });

    it("refuses when the bot connection has no channel to post to", async () => {
      const rig = createPublicApiRig({
        rows: [slackRow({ slackIntegrationId: "slackintegration_bot", slackDelivery: "bot" })],
        connections: [
          {
            view: { id: "slackintegration_bot", kind: "BOT" },
            secret: { kind: "BOT", token: SECRETS.botToken },
          },
        ],
      });
      await expect(fire(rig)).rejects.toMatchObject({ code: "test_fire_unavailable" });
    });
  });

  describe("given a connection the project can no longer use", () => {
    it("refuses, never falling back to a legacy webhook left on the row", async () => {
      const rig = createPublicApiRig({
        rows: [
          slackRow({
            slackIntegrationId: "slackintegration_gone",
            slackWebhook: SECRETS.webhookUrl,
          }),
        ],
      });
      await expect(fire(rig)).rejects.toMatchObject({ code: "test_fire_unavailable" });
      expect(rig.testFire).not.toHaveBeenCalled();
    });
  });

  describe("given a legacy automation with its own webhook and no connection", () => {
    it("fires through its own webhook", async () => {
      const rig = createPublicApiRig({
        rows: [slackRow({ slackDelivery: "webhook", slackWebhook: SECRETS.webhookUrl })],
      });
      await fire(rig);
      expect(rig.testFire).toHaveBeenCalledWith(
        expect.objectContaining({ webhook: SECRETS.webhookUrl }),
      );
    });
  });
});
