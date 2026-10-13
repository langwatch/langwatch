/** @vitest-environment node */
import { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import {
  createPublicApiRig,
  MARKING_CRYPTO,
  SECRET_ROWS,
  SECRETS,
  triggerRow,
  readTrigger,
} from "./automation-rest-redaction.fixture.ts";

const conditions = { "traces.error": ["true"] };

describe("Feature: delivery credentials survive the REST write paths redacted", () => {
  describe("when an automation is created over the API", () => {
    /** @scenario "Creating a trigger echoes it back redacted" */
    it("echoes it back redacted while storing what the caller sent", async () => {
      const rig = createPublicApiRig();
      const response = await rig.api.post("/api/triggers", {
        name: "Hook",
        action: "SEND_WEBHOOK",
        actionParams: {
          url: "https://r.example.com/hook",
          headers: { Authorization: SECRETS.headerValue },
        },
        filters: conditions,
      });
      const body = await readTrigger(response);

      expect(response.status).toBe(201);
      expect(body.actionParams.headers).toEqual({ Authorization: "[redacted]" });
      const stored = rig.rows.get(body.id)?.actionParams ?? {};
      expect(JSON.stringify(stored)).not.toContain(SECRETS.headerValue);
      expect(MARKING_CRYPTO.decrypt(String(stored.headersEncrypted))).toContain(
        SECRETS.headerValue,
      );
    });

    it("declines a listing copied into a create call", async () => {
      const response = await createPublicApiRig().api.post("/api/triggers", {
        name: "Copied",
        action: "SEND_WEBHOOK",
        actionParams: {
          url: "https://r.example.com/hook",
          headers: { Authorization: "[redacted]" },
        },
        filters: conditions,
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });
  });

  describe("when an automation is updated over the API", () => {
    /** @scenario "Updating a trigger echoes it back redacted" */
    it("echoes it back redacted", async () => {
      const rig = createPublicApiRig({ rows: [SECRET_ROWS.webhook] });
      const body = await readTrigger(
        await rig.api.patch("/api/triggers/trigger_webhook", { name: "Renamed" }),
      );

      expect(body.actionParams.signingSecret).toBe("[redacted]");
      expect(JSON.stringify(body)).not.toContain(SECRETS.signingSecret);
    });

    /** @scenario "An integrator writes the read response back and the stored credential survives" */
    it("keeps the header value and the signing secret of a customer endpoint", async () => {
      const rig = createPublicApiRig({ rows: [SECRET_ROWS.webhook] });
      const read = await readTrigger(await rig.api.get("/api/triggers/trigger_webhook"));
      const response = await rig.api.patch("/api/triggers/trigger_webhook", {
        actionParams: read.actionParams,
      });

      expect(response.status).toBe(200);
      const stored = rig.rows.get("trigger_webhook")?.actionParams ?? {};
      expect(MARKING_CRYPTO.decrypt(String(stored.headersEncrypted))).toContain(
        SECRETS.headerValue,
      );
      expect(MARKING_CRYPTO.decrypt(String(stored.signingSecretEncrypted))).toBe(
        SECRETS.signingSecret,
      );
    });

    /** @scenario "Writing back what the API read moves a legacy webhook URL into a connection" */
    it("moves the stored URL into a project connection when the caller writes the response back", async () => {
      const rig = createPublicApiRig({ rows: [SECRET_ROWS.slackLegacyWebhook] });
      const read = await readTrigger(await rig.api.get("/api/triggers/trigger_slack"));
      await rig.api.patch("/api/triggers/trigger_slack", { actionParams: read.actionParams });

      expect(rig.createdConnections).toEqual([
        { kind: "INCOMING_WEBHOOK", secret: SECRETS.webhookUrl },
      ]);
      expect(rig.rows.get("trigger_slack")?.actionParams).toMatchObject({
        slackIntegrationId: "slackintegration_1",
      });
      expect(JSON.stringify(rig.rows.get("trigger_slack")?.actionParams)).not.toContain(
        SECRETS.webhookUrl,
      );
    });

    /** @scenario "A destination the caller did type is the one that is saved" */
    it("saves a destination the caller typed", async () => {
      const rig = createPublicApiRig({ rows: [SECRET_ROWS.slackLegacyWebhook] });
      const typed = "https://hooks.slack.com/services/T0/B0/typed";
      await rig.api.patch("/api/triggers/trigger_slack", {
        actionParams: { slackDelivery: "webhook", slackWebhook: typed },
      });

      expect(rig.createdConnections).toEqual([{ kind: "INCOMING_WEBHOOK", secret: typed }]);
    });

    /** @scenario "Writing back a Slack bot connection keeps its saved token" */
    it("keeps delivering with the saved bot token of a Slack bot automation, stored on a connection", async () => {
      const bot = triggerRow({
        id: "trigger_bot",
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "bot",
          slackBotToken: MARKING_CRYPTO.encrypt(SECRETS.botToken),
          slackChannelId: "C1",
        },
      });
      const rig = createPublicApiRig({ rows: [bot] });
      const read = await readTrigger(await rig.api.get("/api/triggers/trigger_bot"));
      await rig.api.patch("/api/triggers/trigger_bot", { actionParams: read.actionParams });

      expect(rig.createdConnections).toEqual([{ kind: "BOT", secret: SECRETS.botToken }]);
      expect(rig.rows.get("trigger_bot")?.actionParams).toMatchObject({
        slackDelivery: "bot",
        slackChannelId: "C1",
      });
    });

    /** @scenario "Leaving a header out of an update removes it" */
    it("removes the headers an update leaves out", async () => {
      const rig = createPublicApiRig({ rows: [SECRET_ROWS.webhook] });
      await rig.api.patch("/api/triggers/trigger_webhook", {
        actionParams: { url: "https://receiver.example.com/hook", signingSecret: null },
      });

      expect(rig.rows.get("trigger_webhook")?.actionParams.headersEncrypted).toBeUndefined();
    });
  });
});
