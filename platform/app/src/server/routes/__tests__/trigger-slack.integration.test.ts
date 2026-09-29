/**
 * @vitest-environment node
 * `POST /api/trigger/slack` takes exactly one destination: a webhook URL,
 * stored as a connection, or a connection the project can use (ADR-093 §5a).
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerRedactionProject } from "~/app/api/triggers/__tests__/trigger-redaction-fixture";
import {
  type SlackIntegrationKind,
  TriggerAction,
} from "~/generated/prisma/client";
import { globalForApp } from "~/server/app-layer/app";
import { slackSecretFingerprint } from "~/server/app-layer/automations/slack-integration/slack-secret-fingerprint";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { encrypt } from "~/utils/encryption";
import { app } from "../misc";

// Built at runtime so no fixture reads as a real credential.
const WEBHOOK_URL = [
  "https://hooks.slack.com",
  "services",
  "fake",
  nanoid(6),
].join("/");
const BOT_TOKEN = ["xoxb", "fake", nanoid(6)].join("-");

const storedParams = z.object({
  slackIntegrationId: z.string(),
  slackDelivery: z.enum(["webhook", "bot"]),
  slackChannelId: z.string().optional(),
});

describe("Feature: the narrow Slack alert endpoint takes a connection as well as a webhook URL", () => {
  const ns = `trigger-slack-${nanoid(8)}`;
  const { projectId, organizationId, headers } = registerRedactionProject(ns);

  // The route's permission gate decides through the app's permissions service.
  beforeAll(() => {
    globalForApp.__langwatch_app = createTestApp();
  });
  afterAll(() => {
    globalForApp.__langwatch_app = null;
  });

  const createAlert = (body: Record<string, unknown>) =>
    app.request("/api/trigger/slack", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        filters: {},
        alert_type: "INFO",
        ...body,
      }),
    });

  const storeConnection = ({
    kind,
    secret,
    scopeId,
  }: {
    kind: SlackIntegrationKind;
    secret: string;
    scopeId: string;
  }) =>
    prisma.slackIntegration.create({
      data: {
        name: `${kind} ${ns}`,
        kind,
        scopeType: "PROJECT",
        scopeId,
        organizationId: organizationId(),
        botTokenEncrypted: kind === "BOT" ? encrypt(secret) : null,
        webhookUrlEncrypted: kind === "BOT" ? null : encrypt(secret),
        secretFingerprint: slackSecretFingerprint({ secret }),
        secretHint: secret.slice(-4),
        createdById: "test",
        updatedById: "test",
      },
    });

  const findAlert = (name: string) =>
    prisma.trigger.findFirst({
      where: {
        projectId: projectId(),
        name,
        action: TriggerAction.SEND_SLACK_MESSAGE,
      },
    });

  describe("when a Slack alert names a webhook connection", () => {
    /** @scenario A Slack alert is created through a webhook connection */
    it("points the automation at that connection and stores no secret", async () => {
      const connection = await storeConnection({
        kind: "INCOMING_WEBHOOK",
        secret: `${WEBHOOK_URL}/named`,
        scopeId: projectId(),
      });
      const name = `Webhook connection ${ns}`;

      const response = await createAlert({
        name,
        slack_connection_id: connection.id,
      });

      expect(response.status).toBe(200);
      const alert = await findAlert(name);
      expect(alert?.actionParams).toEqual({
        slackIntegrationId: connection.id,
        slackDelivery: "webhook",
      });
    });
  });

  describe("when a Slack alert names a bot connection", () => {
    /** @scenario A Slack alert is created through a bot connection and a channel */
    it("points the automation at that connection and its channel", async () => {
      const connection = await storeConnection({
        kind: "BOT",
        secret: BOT_TOKEN,
        scopeId: projectId(),
      });
      const name = `Bot connection ${ns}`;

      const response = await createAlert({
        name,
        slack_connection_id: connection.id,
        slack_channel_id: "C0123",
      });

      expect(response.status).toBe(200);
      expect((await findAlert(name))?.actionParams).toEqual({
        slackIntegrationId: connection.id,
        slackDelivery: "bot",
        slackChannelId: "C0123",
      });
    });

    /** @scenario A Slack alert through a bot connection needs a channel */
    it("refuses it without a channel and creates nothing", async () => {
      const connection = await prisma.slackIntegration.findFirstOrThrow({
        where: { organizationId: organizationId(), kind: "BOT" },
      });
      const name = `Bot without channel ${ns}`;

      const response = await createAlert({
        name,
        slack_connection_id: connection.id,
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("invalid_action_params");
      expect(await findAlert(name)).toBeNull();
    });
  });

  describe("when a Slack alert gives a webhook URL", () => {
    /** @scenario A Slack alert with a webhook URL is stored as a connection */
    it("stores the URL as a project connection and the automation as its id", async () => {
      const name = `Webhook URL ${ns}`;

      const response = await createAlert({
        name,
        slack_webhook: WEBHOOK_URL,
      });

      expect(response.status).toBe(200);
      const alert = await findAlert(name);
      expect(JSON.stringify(alert?.actionParams)).not.toContain("hooks.slack");
      const { slackIntegrationId } = storedParams.parse(alert?.actionParams);
      expect(
        await prisma.slackIntegration.findUniqueOrThrow({
          where: { id: slackIntegrationId },
        }),
      ).toMatchObject({ scopeType: "PROJECT", scopeId: projectId() });
    });
  });

  describe("when a Slack alert names no destination, or two", () => {
    /** @scenario A Slack alert naming no destination is refused */
    it("refuses one with neither", async () => {
      const name = `Neither ${ns}`;

      const response = await createAlert({ name });

      expect(response.status).toBe(400);
      expect(await findAlert(name)).toBeNull();
    });

    /** @scenario A Slack alert naming two destinations is refused */
    it("refuses one with both", async () => {
      const connection = await prisma.slackIntegration.findFirstOrThrow({
        where: { organizationId: organizationId(), kind: "BOT" },
      });
      const name = `Both ${ns}`;

      const response = await createAlert({
        name,
        slack_webhook: WEBHOOK_URL,
        slack_connection_id: connection.id,
        slack_channel_id: "C0123",
      });

      expect(response.status).toBe(400);
      expect(await findAlert(name)).toBeNull();
    });
  });

  describe("when a Slack alert names a connection the project cannot use", () => {
    /** @scenario A Slack alert naming a connection the project cannot use is refused */
    it("refuses another project's connection and an unknown one alike", async () => {
      const otherProjects = await storeConnection({
        kind: "INCOMING_WEBHOOK",
        secret: `${WEBHOOK_URL}/elsewhere`,
        scopeId: `another-project-${ns}`,
      });

      for (const id of [otherProjects.id, `unknown-${ns}`]) {
        const name = `Unusable ${id}`;
        const response = await createAlert({ name, slack_connection_id: id });

        expect(response.status).toBe(422);
        expect((await response.json()).error).toBe("slack_integration_missing");
        expect(await findAlert(name)).toBeNull();
      }
    });
  });
});
