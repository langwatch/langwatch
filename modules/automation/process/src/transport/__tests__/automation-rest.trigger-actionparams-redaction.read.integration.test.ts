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
  readTriggers,
} from "./automation-rest-redaction.fixture.ts";

const leaks = (body: unknown) =>
  Object.values(SECRETS).some((secret) => JSON.stringify(body).includes(secret)) ||
  JSON.stringify(body).includes("enc(");

describe("Feature: delivery credentials are redacted on the REST read paths", () => {
  describe("given automations that deliver over Slack and to a customer endpoint", () => {
    describe("when the automations are listed", () => {
      /** @scenario "A listed trigger never contains a secret" */
      it("answers with the placeholder and no credential value anywhere", async () => {
        const { api } = createPublicApiRig({ rows: Object.values(SECRET_ROWS) });
        const body = await readTriggers(await api.get("/api/triggers"));

        expect(leaks(body)).toBe(false);
        const webhook = body.find((row) => row.id === "trigger_webhook");
        expect(webhook?.actionParams).toMatchObject({
          url: "https://receiver.example.com/hook",
          headers: { Authorization: "[redacted]" },
          signingSecret: "[redacted]",
        });
      });

      /** @scenario "The listing includes paused automations" */
      it("includes paused automations", async () => {
        const { api } = createPublicApiRig({ rows: [{ ...SECRET_ROWS.webhook, active: false }] });
        expect(await (await api.get("/api/triggers")).json()).toHaveLength(1);
      });
    });

    describe("when one automation is read by its id", () => {
      /** @scenario "Reading one trigger redacts it the same way" */
      it("answers without the credential value", async () => {
        const { api } = createPublicApiRig({ rows: Object.values(SECRET_ROWS) });
        const body = await readTrigger(await api.get("/api/triggers/trigger_slack"));

        expect(leaks(body)).toBe(false);
        expect(body.actionParams).toEqual({ slackDelivery: "webhook" });
      });
    });
  });

  describe("given an automation whose saved credentials cannot be read back", () => {
    /** @scenario "A delivery configuration that cannot be read comes back empty" */
    it("still lists, with its delivery configuration empty", async () => {
      const broken = triggerRow({
        id: "trigger_broken",
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: {
          url: "https://r.example.com",
          method: "POST",
          bodyTemplate: null,
          headersEncrypted: "not-ours",
        },
      });
      const { api } = createPublicApiRig({ rows: [broken, SECRET_ROWS.webhook] });
      const response = await api.get("/api/triggers");

      expect(response.status).toBe(200);
      const body = await readTriggers(response);
      expect(body.find((row) => row.id === "trigger_broken")?.actionParams).toEqual({});
      expect(MARKING_CRYPTO.decrypt(MARKING_CRYPTO.encrypt("x"))).toBe("x");
    });
  });
});
