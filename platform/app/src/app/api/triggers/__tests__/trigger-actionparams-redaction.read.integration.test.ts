/**
 * Delivery credentials are redacted at the REST boundary: the read paths.
 * These run against the real route and the real database because the rule
 * belongs to the boundary itself: every verb answers through one response
 * mapper, and what a client receives is what that mapper emitted after Hono
 * serialised it.
 */
import { nanoid } from "nanoid";
import { describe, expect, it, vi } from "vitest";
import { TriggerAction } from "~/generated/prisma/client";
import { PrismaTriggerRepository } from "~/server/app-layer/automations/repositories/trigger.prisma.repository";
import { TriggerService } from "~/server/app-layer/automations/trigger.service";
import { REDACTED_CREDENTIAL } from "~/server/app-layer/automations/trigger-redaction";
import { prisma } from "~/server/db";
import { encrypt } from "~/utils/encryption";
import {
  ENDPOINT_URL,
  registerRedactionProject,
  SLACK_WEBHOOK,
  WEBHOOK_HEADER_VALUE,
  WEBHOOK_SIGNING_SECRET,
} from "./trigger-redaction-fixture";

// The route reads and writes through the app layer's trigger service. Wiring
// that service over the real repository is what keeps this suite about the
// route's own rules rather than about booting every other slice of the app.
vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    triggers: new TriggerService(new PrismaTriggerRepository(prisma)),
  }),
}));

import { app } from "../[[...route]]/app";

describe("Feature: delivery credentials are redacted on the REST read paths", () => {
  const ns = `triggers-redaction-read-${nanoid(8)}`;
  const { headers, storeTrigger } = registerRedactionProject(ns);

  describe("given automations that deliver over Slack and to a customer endpoint", () => {
    describe("when the automations are listed", () => {
      /** @scenario "A listed trigger never contains a secret" */
      it("answers with the placeholder and no credential value anywhere", async () => {
        const slack = await storeTrigger({
          name: `Slack delivery ${ns}`,
          action: TriggerAction.SEND_SLACK_MESSAGE,
          actionParams: {
            slackDelivery: "webhook",
            slackWebhook: SLACK_WEBHOOK,
          },
        });
        // The at-rest shape the product writes: header values are encrypted
        // (ADR-040 §3), and only their names are readable without the key.
        const endpoint = await storeTrigger({
          name: `Endpoint delivery ${ns}`,
          action: TriggerAction.SEND_WEBHOOK,
          actionParams: {
            url: ENDPOINT_URL,
            method: "POST",
            headersEncrypted: encrypt(
              JSON.stringify({ Authorization: WEBHOOK_HEADER_VALUE }),
            ),
            signingSecretEncrypted: encrypt(WEBHOOK_SIGNING_SECRET),
          },
        });

        const response = await app.request("/api/triggers", {
          headers: headers(),
        });

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body).not.toContain(SLACK_WEBHOOK);
        expect(body).not.toContain("hooks.slack.com");
        expect(body).not.toContain(WEBHOOK_HEADER_VALUE);
        expect(body).not.toContain("sk-live");
        expect(body).not.toContain(WEBHOOK_SIGNING_SECRET);
        expect(body).not.toContain("headersEncrypted");
        expect(body).not.toContain("signingSecretEncrypted");

        const listed = JSON.parse(body) as {
          id: string;
          actionParams: Record<string, unknown>;
        }[];
        const slackRow = listed.find((row) => row.id === slack.id);
        expect(slackRow?.actionParams).toEqual({
          slackDelivery: "webhook",
          slackWebhook: REDACTED_CREDENTIAL,
        });

        const endpointRow = listed.find((row) => row.id === endpoint.id);
        // The delivery shape stays readable: the destination and the header
        // name are still there for an integrator to reason about.
        expect(endpointRow?.actionParams).toMatchObject({
          url: ENDPOINT_URL,
          headers: { Authorization: REDACTED_CREDENTIAL },
          signingSecret: REDACTED_CREDENTIAL,
        });
      });
    });

    describe("when one automation is read by its id", () => {
      /** @scenario "Reading one trigger redacts it the same way" */
      it("answers without the credential value", async () => {
        const stored = await storeTrigger({
          name: `Read by id ${ns}`,
          action: TriggerAction.SEND_SLACK_MESSAGE,
          actionParams: {
            slackDelivery: "webhook",
            slackWebhook: SLACK_WEBHOOK,
          },
        });

        const response = await app.request(`/api/triggers/${stored.id}`, {
          headers: headers(),
        });

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body).not.toContain(SLACK_WEBHOOK);
        expect(JSON.parse(body).actionParams.slackWebhook).toBe(
          REDACTED_CREDENTIAL,
        );
      });
    });
  });

  describe("given an automation stored before header values were encrypted", () => {
    it("still reads, with the header name kept and the value hidden", async () => {
      const stored = await storeTrigger({
        name: `Legacy endpoint ${ns}`,
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: {
          url: ENDPOINT_URL,
          headers: { Authorization: WEBHOOK_HEADER_VALUE },
        },
      });

      const response = await app.request(`/api/triggers/${stored.id}`, {
        headers: headers(),
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain(WEBHOOK_HEADER_VALUE);
      expect(JSON.parse(body).actionParams).toMatchObject({
        url: ENDPOINT_URL,
        headers: { Authorization: REDACTED_CREDENTIAL },
      });
    });
  });
});
