/**
 * Delivery credentials are redacted at the REST boundary. These run against the
 * real route and the real database because the rule belongs to the boundary
 * itself: every verb answers through one response mapper, and what a client
 * receives is what that mapper emitted after Hono serialised it.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type Organization,
  type Prisma,
  type Project,
  type Team,
  TriggerAction,
  TriggerKind,
} from "~/generated/prisma/client";
import { graphAlertActionParamsSchema } from "~/server/app-layer/automations/graph-alert.builder";
import {
  decryptWebhookHeaders,
  type WebhookStoredActionParams,
} from "~/server/app-layer/automations/providers/webhook/server";
import { reportActionParamsSchema } from "~/server/app-layer/automations/report.builder";
import { PrismaTriggerRepository } from "~/server/app-layer/automations/repositories/trigger.prisma.repository";
import { TriggerService } from "~/server/app-layer/automations/trigger.service";
import { REDACTED_CREDENTIAL } from "~/server/app-layer/automations/trigger-redaction";
import { prisma } from "~/server/db";
import { decrypt, encrypt } from "~/utils/encryption";

// The route reads and writes through the app layer's trigger service. Wiring
// that service over the real repository is what keeps this suite about the
// route's own rules rather than about booting every other slice of the app.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    triggers: new TriggerService(new PrismaTriggerRepository(prisma)),
  }),
}));

import { app } from "../[[...route]]/app";

const SLACK_WEBHOOK =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX";
const WEBHOOK_HEADER_VALUE = "Bearer sk-live-abcdefghijklmnop";
const WEBHOOK_SIGNING_SECRET = "whsec-abcdefghijklmnopqrstuvwxyz";
const SLACK_BOT_TOKEN = "xoxb-000000000000-abcdefghijkl";
const ENDPOINT_URL = "https://example.com/hooks/langwatch";

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
        actionParams: data.actionParams as Prisma.InputJsonValue,
      },
    });

  /** The read-modify-write an integrator performs: read the automation, then
   *  send the delivery configuration back exactly as it arrived. */
  const writeBack = async (id: string) => {
    const read = (await (
      await app.request(`/api/triggers/${id}`, { headers: headers() })
    ).json()) as { actionParams: Record<string, unknown> };

    return app.request(`/api/triggers/${id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ actionParams: read.actionParams }),
    });
  };

  // Several fixtures deliver to a customer endpoint, a channel a project only
  // has once it is turned on for them.
  const previousFlagOverride = process.env.FEATURE_FLAG_FORCE_ENABLE;

  beforeAll(async () => {
    process.env.FEATURE_FLAG_FORCE_ENABLE = "release_webhook_automations";
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
    if (previousFlagOverride === undefined) {
      delete process.env.FEATURE_FLAG_FORCE_ENABLE;
    } else {
      process.env.FEATURE_FLAG_FORCE_ENABLE = previousFlagOverride;
    }
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
        // The at-rest shape the product writes: header values are encrypted
        // (ADR-040 §3), and only their names are readable without the key.
        await storeTrigger({
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

    /** @scenario "Writing back a graph alert keeps the rule it fires by" */
    it("keeps the rule a graph alert fires by", async () => {
      const rule = {
        threshold: 5,
        operator: "gt",
        timePeriod: 60,
        seriesName: "Errors",
      };
      const stored = await storeTrigger({
        name: `Graph alert ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
          ...rule,
        },
      });

      const response = await writeBack(stored.id);

      expect(response.status).toBe(200);
      const saved = (
        await prisma.trigger.findUniqueOrThrow({
          where: { id: stored.id, projectId: projectId() },
        })
      ).actionParams;
      expect(saved).toMatchObject({ ...rule, slackWebhook: SLACK_WEBHOOK });
      // The evaluator reads the rule straight off the row, so what matters is
      // that it still parses as a complete one.
      expect(graphAlertActionParamsSchema.safeParse(saved).success).toBe(true);
    });

    /** @scenario "Writing back a scheduled report keeps its schedule" */
    it("keeps the schedule a report sends on", async () => {
      const report = {
        source: { kind: "dashboard", dashboardId: "dashboard_1" },
        schedule: { cron: "0 9 * * 1", timezone: "Europe/Amsterdam" },
        compareToPrevious: true,
      };
      const stored = await storeTrigger({
        name: `Report ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
          ...report,
        },
      });

      const response = await writeBack(stored.id);

      expect(response.status).toBe(200);
      const saved = (
        await prisma.trigger.findUniqueOrThrow({
          where: { id: stored.id, projectId: projectId() },
        })
      ).actionParams;
      expect(saved).toMatchObject(report);
      // The dispatcher skips a report it cannot read a source and schedule
      // from, so what matters is that both still parse.
      expect(reportActionParamsSchema.safeParse(saved).success).toBe(true);
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

  describe("when an automation is deleted", () => {
    /** @scenario "Deleting a trigger reports the deletion" */
    it("names the automation and reports it deleted", async () => {
      const stored = await storeTrigger({
        name: `Deleted ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
        },
      });

      const response = await app.request(`/api/triggers/${stored.id}`, {
        method: "DELETE",
        headers: headers(),
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain(SLACK_WEBHOOK);
      expect(JSON.parse(body)).toEqual({ id: stored.id, deleted: true });
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
