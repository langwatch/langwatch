/**
 * Delivery credentials are redacted at the REST boundary. These run against the
 * real route and the real database because the rule belongs to the boundary
 * itself: every verb answers through one response mapper, and what a client
 * receives is what that mapper emitted after Hono serialised it.
 */
import {
  type Organization,
  type Project,
  type Team,
  TriggerAction,
  TriggerKind,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { REDACTED_CREDENTIAL } from "~/server/app-layer/automations/trigger-redaction";
import { prisma } from "~/server/db";

// The route invalidates the active-triggers cache after a successful write.
// That is the only thing it needs the app layer for, and booting the whole app
// to no-op one cache drop would buy nothing this suite asserts.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ triggers: { invalidate: async () => {} } }),
}));

import { app } from "../[[...route]]/app";

const SLACK_WEBHOOK =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX";
const WEBHOOK_HEADER_VALUE = "Bearer sk-live-abcdefghijklmnop";

describe("Feature: delivery credentials are redacted at the REST boundary", () => {
  const ns = `triggers-redaction-${nanoid(8)}`;

  let organization: Organization | undefined;
  let team: Team | undefined;
  let project: Project | undefined;

  const projectId = () => project!.id;

  const headers = () => ({
    "X-Auth-Token": project!.apiKey,
    "Content-Type": "application/json",
  });

  const storeTrigger = (data: {
    name: string;
    action: TriggerAction;
    actionParams: Record<string, unknown>;
  }) =>
    prisma.trigger.create({
      data: {
        id: nanoid(),
        projectId: projectId(),
        filters: JSON.stringify({ "metadata.labels": ["prod"] }),
        triggerKind: TriggerKind.AUTOMATION,
        ...data,
      },
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Triggers Redaction Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Triggers Redaction Team",
        slug: `--test-team-${ns}`,
        organizationId: organization!.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Triggers Redaction Project",
        slug: `--test-project-${ns}`,
        teamId: team!.id,
        language: "other",
        framework: "other",
        apiKey: `test-api-key-${ns}`,
      },
    });
  });

  afterAll(async () => {
    if (project) {
      await prisma.trigger.deleteMany({ where: { projectId: projectId() } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    if (team) await prisma.team.delete({ where: { id: team.id } });
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

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
        await storeTrigger({
          name: `Endpoint delivery ${ns}`,
          action: TriggerAction.SEND_WEBHOOK,
          actionParams: {
            url: "https://example.com/hooks/langwatch",
            method: "POST",
            headers: { Authorization: WEBHOOK_HEADER_VALUE },
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

        const listed = JSON.parse(body) as {
          id: string;
          actionParams: Record<string, unknown>;
        }[];
        const slackRow = listed.find((row) => row.id === slack.id);
        expect(slackRow?.actionParams).toEqual({
          slackDelivery: "webhook",
          slackWebhook: REDACTED_CREDENTIAL,
        });

        const endpointRow = listed.find(
          (row) => row.id !== slack.id && "url" in row.actionParams,
        );
        // The delivery shape stays readable: the destination and the header
        // name are still there for an integrator to reason about.
        expect(endpointRow?.actionParams).toMatchObject({
          url: "https://example.com/hooks/langwatch",
          headers: { Authorization: REDACTED_CREDENTIAL },
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
      const created = JSON.parse(body) as { id: string };
      expect(
        await prisma.trigger.findUniqueOrThrow({
          where: { id: created.id, projectId: projectId() },
        }),
      ).toMatchObject({
        actionParams: { slackWebhook: SLACK_WEBHOOK },
      });
    });

    it("declines to store the placeholder as a destination", async () => {
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

      expect(response.status).toBe(201);
      const created = (await response.json()) as { id: string };
      const stored = await prisma.trigger.findUniqueOrThrow({
        where: { id: created.id, projectId: projectId() },
      });
      expect(stored.actionParams).toEqual({ slackDelivery: "webhook" });
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

      const read = (await (
        await app.request(`/api/triggers/${stored.id}`, { headers: headers() })
      ).json()) as { actionParams: Record<string, unknown> };

      const response = await app.request(`/api/triggers/${stored.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          actionParams: { ...read.actionParams, slackDelivery: "webhook" },
        }),
      });

      expect(response.status).toBe(200);
      expect(
        await prisma.trigger.findUniqueOrThrow({
          where: { id: stored.id, projectId: projectId() },
        }),
      ).toMatchObject({ actionParams: { slackWebhook: SLACK_WEBHOOK } });
    });
  });
});
