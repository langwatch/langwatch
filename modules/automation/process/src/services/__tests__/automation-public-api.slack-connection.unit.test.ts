import { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import {
  createPublicApiRig,
  SECRETS,
} from "../../transport/__tests__/automation-rest-redaction.fixture.ts";

const create = (
  rig: ReturnType<typeof createPublicApiRig>,
  actionParams: Record<string, unknown>,
  filters: Record<string, string[]> = { "traces.error": ["true"] },
) =>
  rig.service.create({
    projectId: "project_1",
    actorId: "user_1",
    input: {
      name: "Slack errors",
      action: TriggerAction.SEND_SLACK_MESSAGE,
      actionParams,
      filters,
    },
  });

describe("AutomationPublicApiService.create() for Slack", () => {
  describe("given a connection id and a channel", () => {
    /** @scenario "A Slack alert is created through a bot connection and a channel" */
    /** @scenario "The API accepts a connection id" */
    it("points the automation at the connection and reads back no secret", async () => {
      const rig = createPublicApiRig({
        connections: [
          {
            view: { id: "slackintegration_bot", kind: "BOT" },
            secret: { kind: "BOT", token: SECRETS.botToken },
          },
        ],
      });
      const created = await create(rig, {
        slackIntegrationId: "slackintegration_bot",
        slackChannelId: "C123",
      });
      expect(rig.rows.get(created.id)?.actionParams).toEqual({
        slackIntegrationId: "slackintegration_bot",
        slackDelivery: "bot",
        slackChannelId: "C123",
      });
      expect(JSON.stringify(created)).toContain("slackintegration_bot");
      expect(JSON.stringify(created)).not.toContain(SECRETS.botToken);
    });

    /** @scenario "A Slack alert through a bot connection needs a channel" */
    it("refuses a bot connection with no channel", async () => {
      const rig = createPublicApiRig({
        connections: [
          {
            view: { id: "slackintegration_bot", kind: "BOT" },
            secret: { kind: "BOT", token: SECRETS.botToken },
          },
        ],
      });
      await expect(
        create(rig, { slackIntegrationId: "slackintegration_bot" }),
      ).rejects.toMatchObject({
        code: "invalid_action_params",
      });
    });
  });

  describe("given a legacy webhook URL on a create refused for its condition", () => {
    it("stores no connection", async () => {
      const rig = createPublicApiRig();
      await expect(create(rig, { slackWebhook: SECRETS.webhookUrl }, {})).rejects.toMatchObject({
        code: "trigger_filters_required",
      });
      expect(rig.createdConnections).toEqual([]);
    });
  });

  describe("given a legacy webhook URL", () => {
    /** @scenario "A Slack alert with a webhook URL is stored as a connection" */
    /** @scenario "A legacy secret over the API is stored as a connection" */
    it("finds or creates a project connection and stores no secret of its own", async () => {
      const rig = createPublicApiRig();
      const created = await create(rig, { slackWebhook: SECRETS.webhookUrl });
      expect(rig.createdConnections).toEqual([
        { kind: "INCOMING_WEBHOOK", secret: SECRETS.webhookUrl },
      ]);
      expect(rig.rows.get(created.id)?.actionParams).toMatchObject({
        slackIntegrationId: "slackintegration_1",
      });
      expect(JSON.stringify(rig.rows.get(created.id)?.actionParams)).not.toContain(
        SECRETS.webhookUrl,
      );
    });
  });
});
