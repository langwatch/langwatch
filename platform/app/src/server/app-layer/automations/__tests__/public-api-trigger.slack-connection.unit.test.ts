import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake cipher and fingerprint: what this file pins is where the secret ends
// up (a connection, never the automation row), not AES or HMAC.
vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value.replace(/^enc\(/, "").replace(/\)$/, ""),
}));
vi.mock("../slack-integration/slack-secret-fingerprint", () => ({
  slackSecretFingerprint: ({ secret }: { secret: string }) =>
    `fp(${secret.trim()})`,
  slackSecretHint: ({ secret }: { secret: string }) => secret.trim().slice(-4),
}));

import type { Prisma, Trigger } from "~/generated/prisma/client";
import { TriggerAction, TriggerKind } from "~/generated/prisma/client";
import { PublicApiTriggerService } from "../public-api-trigger.service";
import { FakeSlackIntegrationRepository } from "../slack-integration/__tests__/fakeSlackIntegrationRepository";
import { SlackIntegrationService } from "../slack-integration/slack-integration.service";
import { redactTriggerForPublicApi } from "../trigger-redaction";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/abcd";

/** A row as the store returns it: the written data over fixed bookkeeping. */
const rowFrom = (data: Prisma.TriggerUncheckedCreateInput): Trigger => ({
  id: data.id ?? "automation-1",
  projectId: data.projectId,
  name: data.name,
  action: data.action,
  triggerKind: data.triggerKind ?? TriggerKind.AUTOMATION,
  // Round-tripped as the column would: written input in, stored JSON out.
  actionParams: JSON.parse(JSON.stringify(data.actionParams ?? {})),
  filters: "{}",
  filterQuery: data.filterQuery ?? null,
  deleted: false,
  active: true,
  alertType: null,
  message: null,
  customGraphId: null,
  slackTemplateType: null,
  slackTemplate: null,
  emailSubjectTemplate: null,
  emailBodyTemplate: null,
  lastRunAt: 0,
  notificationCadence: "IMMEDIATE",
  traceDebounceMs: 0,
  pausedReason: null,
  pausedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe("PublicApiTriggerService.create() for Slack", () => {
  let repo: FakeSlackIntegrationRepository;
  let service: PublicApiTriggerService;
  let created: Trigger | undefined;

  beforeEach(() => {
    repo = new FakeSlackIntegrationRepository();
    created = undefined;
    const triggers = {
      create: vi.fn(
        async ({ data }: { data: Prisma.TriggerUncheckedCreateInput }) => {
          created = rowFrom(data);
          return created;
        },
      ),
      invalidate: async () => undefined,
    };
    service = new PublicApiTriggerService(triggers as never, {
      graphs: {} as never,
      fireHistory: {} as never,
      filterValidation: { assertWritable: async () => undefined },
      testFire: vi.fn() as never,
      resolveProject: vi.fn() as never,
      slackConnections: new SlackIntegrationService(repo, async () => ({
        ok: true,
        identity: { teamId: "T1", teamName: "Acme" },
      })),
    });
  });

  const createSlack = (actionParams: Record<string, unknown>) =>
    service.create({
      projectId: "project-1",
      actorId: "user-1",
      input: {
        name: "Errors to Slack",
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams,
        filterQuery: 'status:"error"',
      },
    });

  describe("given a connection id and a channel", () => {
    /** @scenario "The API accepts a connection id" */
    it("points the automation at the connection and reads back no secret", async () => {
      const stored = await repo.create({
        record: {
          name: "Alerts bot",
          kind: "BOT",
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          organizationId: "org-1",
          botTokenEncrypted: "enc(xoxb-secret)",
          webhookUrlEncrypted: null,
          secretFingerprint: "fp(xoxb-secret)",
          secretHint: "cret",
          slackTeamId: "T1",
          slackTeamName: "Acme",
        },
        actorId: "user-1",
      });
      const id = stored!.id;

      const trigger = await createSlack({
        slackIntegrationId: id,
        slackChannelId: "C0123",
      });

      expect(trigger.actionParams).toEqual({
        slackIntegrationId: id,
        slackDelivery: "bot",
        slackChannelId: "C0123",
      });
      const read = JSON.stringify(redactTriggerForPublicApi(trigger));
      expect(read).toContain(id);
      expect(read).not.toContain("xoxb-secret");
    });
  });

  describe("given a legacy webhook URL on a create refused for its condition", () => {
    it("stores no connection", async () => {
      await expect(
        service.create({
          projectId: "project-1",
          actorId: "user-1",
          input: {
            name: "Errors to Slack",
            action: TriggerAction.SEND_SLACK_MESSAGE,
            actionParams: { slackWebhook: WEBHOOK },
            filters: {},
          },
        }),
      ).rejects.toMatchObject({ code: "trigger_filters_required" });
      expect(repo.rows.size).toBe(0);
      expect(created).toBeUndefined();
    });
  });

  describe("given a legacy webhook URL", () => {
    /** @scenario "A legacy secret over the API is stored as a connection" */
    it("finds or creates a project connection and stores no secret of its own", async () => {
      const other = await repo.create({
        record: {
          name: "Search alerts",
          kind: "INCOMING_WEBHOOK",
          scopeType: "PROJECT",
          scopeId: "project-2",
          organizationId: "org-1",
          botTokenEncrypted: null,
          webhookUrlEncrypted: `enc(${WEBHOOK})`,
          secretFingerprint: `fp(${WEBHOOK})`,
          secretHint: "abcd",
          slackTeamId: null,
          slackTeamName: null,
        },
        actorId: "user-2",
      });
      const otherBefore = { ...other! };

      const trigger = await createSlack({ slackWebhook: WEBHOOK });

      expect(repo.rows.get(otherBefore.id)).toEqual(otherBefore);
      const connection = [...repo.rows.values()].find(
        (row) => row.id !== otherBefore.id,
      );
      expect(connection).toMatchObject({
        kind: "INCOMING_WEBHOOK",
        scopeType: "PROJECT",
        scopeId: "project-1",
        webhookUrlEncrypted: `enc(${WEBHOOK})`,
      });
      expect(created?.actionParams).toEqual({
        slackIntegrationId: connection?.id,
        slackDelivery: "webhook",
      });
      expect(JSON.stringify(trigger.actionParams)).not.toContain(WEBHOOK);

      await createSlack({ slackWebhook: WEBHOOK });
      expect(repo.rows.size).toBe(2);
      expect(repo.rows.get(otherBefore.id)).toEqual(otherBefore);
    });
  });
});
