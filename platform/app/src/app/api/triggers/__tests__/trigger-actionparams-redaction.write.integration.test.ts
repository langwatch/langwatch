/**
 * Delivery credentials are redacted at the REST boundary: the write paths.
 * Creating and updating echo the automation back redacted, while what is
 * stored — and what deliveries actually use — keeps the real credential.
 */
import { nanoid } from "nanoid";
import { describe, expect, it, vi } from "vitest";
import { TriggerAction } from "~/generated/prisma/client";
import {
  decryptWebhookHeaders,
  type WebhookStoredActionParams,
} from "~/server/app-layer/automations/providers/webhook/server";
import { PrismaTriggerRepository } from "~/server/app-layer/automations/repositories/trigger.prisma.repository";
import { TriggerService } from "~/server/app-layer/automations/trigger.service";
import { REDACTED_CREDENTIAL } from "~/server/app-layer/automations/trigger-redaction";
import { prisma } from "~/server/db";
import { decrypt, encrypt } from "~/utils/encryption";
import {
  ENDPOINT_URL,
  registerRedactionProject,
  SLACK_BOT_TOKEN,
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

describe("Feature: delivery credentials survive the REST write paths redacted", () => {
  const ns = `triggers-redaction-write-${nanoid(8)}`;
  const { projectId, headers, storeTrigger, makeWriteBack } =
    registerRedactionProject(ns);
  const writeBack = makeWriteBack((input, init) => app.request(input, init));

  describe("when an automation is created over the API", () => {
    /** @scenario "Creating a trigger echoes it back redacted" */
    it("echoes it back redacted while storing what the caller sent", async () => {
      const response = await app.request("/api/triggers", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          name: `Created over the API ${ns}`,
          action: TriggerAction.SEND_SLACK_MESSAGE,
          actionParams: {
            slackDelivery: "webhook",
            slackWebhook: SLACK_WEBHOOK,
          },
          filters: { "metadata.labels": ["prod"] },
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.text();
      expect(body).not.toContain(SLACK_WEBHOOK);
      const created = JSON.parse(body) as {
        id: string;
        actionParams: Record<string, unknown>;
      };
      // The create response redacts like a read: the shape stays visible,
      // the credential comes back as the placeholder.
      expect(created.actionParams).toMatchObject({
        slackWebhook: REDACTED_CREDENTIAL,
      });
      expect(
        await prisma.trigger.findUniqueOrThrow({
          where: { id: created.id, projectId: projectId() },
        }),
      ).toMatchObject({
        actionParams: { slackWebhook: SLACK_WEBHOOK },
      });
    });

    // A listing copied into a create call names no destination — the
    // placeholder stands for a credential this new automation has never had.
    it("declines a listing copied into a create call", async () => {
      const response = await app.request("/api/triggers", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          name: `Created from a listing ${ns}`,
          action: TriggerAction.SEND_SLACK_MESSAGE,
          actionParams: {
            slackDelivery: "webhook",
            slackWebhook: REDACTED_CREDENTIAL,
          },
          filters: { "metadata.labels": ["prod"] },
        }),
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("invalid_action_params");
      expect(
        await prisma.trigger.count({
          where: {
            projectId: projectId(),
            name: `Created from a listing ${ns}`,
          },
        }),
      ).toBe(0);
    });
  });

  describe("when an automation is updated over the API", () => {
    /** @scenario "Updating a trigger echoes it back redacted" */
    it("echoes it back redacted", async () => {
      const stored = await storeTrigger({
        name: `Renamed ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
        },
      });

      const response = await app.request(`/api/triggers/${stored.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ name: `Renamed again ${ns}` }),
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain(SLACK_WEBHOOK);
      expect(JSON.parse(body).actionParams.slackWebhook).toBe(
        REDACTED_CREDENTIAL,
      );
    });

    it("keeps the stored destination when the caller writes the response back", async () => {
      const stored = await storeTrigger({
        name: `Round trip ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
        },
      });

      const response = await writeBack(stored.id);

      expect(response.status).toBe(200);
      expect(
        await prisma.trigger.findUniqueOrThrow({
          where: { id: stored.id, projectId: projectId() },
        }),
      ).toMatchObject({ actionParams: { slackWebhook: SLACK_WEBHOOK } });
    });

    /** @scenario "A destination the caller did type is the one that is saved" */
    it("saves a destination the caller typed", async () => {
      const stored = await storeTrigger({
        name: `Retargeted ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
        },
      });
      const typed = "https://hooks.slack.com/services/T1/B1/typed";

      const response = await app.request(`/api/triggers/${stored.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          actionParams: { slackDelivery: "webhook", slackWebhook: typed },
        }),
      });

      expect(response.status).toBe(200);
      expect(
        await prisma.trigger.findUniqueOrThrow({
          where: { id: stored.id, projectId: projectId() },
        }),
      ).toMatchObject({ actionParams: { slackWebhook: typed } });
    });

    /** @scenario "An integrator writes the read response back and the stored credential survives" */
    it("keeps the header value and the signing secret of a customer endpoint", async () => {
      const stored = await storeTrigger({
        name: `Endpoint round trip ${ns}`,
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

      const response = await writeBack(stored.id);

      expect(response.status).toBe(200);
      const saved = (
        await prisma.trigger.findUniqueOrThrow({
          where: { id: stored.id, projectId: projectId() },
        })
      ).actionParams as unknown as WebhookStoredActionParams;
      // Assert on what the deliveries can actually use: the header the request
      // will carry, and the secret it will be signed with.
      expect(decryptWebhookHeaders(saved)).toEqual({
        Authorization: WEBHOOK_HEADER_VALUE,
      });
      expect(decrypt(saved.signingSecretEncrypted!)).toBe(
        WEBHOOK_SIGNING_SECRET,
      );
    });

    /** @scenario "Writing back a Slack bot connection keeps its saved token" */
    it("keeps the saved bot token of a Slack bot connection", async () => {
      const stored = await storeTrigger({
        name: `Bot round trip ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "bot",
          slackChannelId: "C123",
          slackBotToken: encrypt(SLACK_BOT_TOKEN),
        },
      });

      const response = await writeBack(stored.id);

      expect(response.status).toBe(200);
      const saved = (
        await prisma.trigger.findUniqueOrThrow({
          where: { id: stored.id, projectId: projectId() },
        })
      ).actionParams as { slackBotToken: string; slackChannelId: string };
      expect(decrypt(saved.slackBotToken)).toBe(SLACK_BOT_TOKEN);
      expect(saved.slackChannelId).toBe("C123");
    });

    /** @scenario "Leaving a header out of an update removes it" */
    it("removes the headers an update leaves out", async () => {
      const stored = await storeTrigger({
        name: `Header cleared ${ns}`,
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: {
          url: ENDPOINT_URL,
          method: "POST",
          headersEncrypted: encrypt(
            JSON.stringify({ Authorization: WEBHOOK_HEADER_VALUE }),
          ),
        },
      });

      const response = await app.request(`/api/triggers/${stored.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          actionParams: { url: ENDPOINT_URL, method: "POST" },
        }),
      });

      expect(response.status).toBe(200);
      const saved = (
        await prisma.trigger.findUniqueOrThrow({
          where: { id: stored.id, projectId: projectId() },
        })
      ).actionParams as unknown as WebhookStoredActionParams;
      expect(decryptWebhookHeaders(saved)).toEqual({});
    });
  });
});
