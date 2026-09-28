import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake cipher and fingerprint so these tests exercise the service's
// orchestration (validate, dedupe, then store) rather than AES or HMAC.
vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value.replace(/^enc\(/, "").replace(/\)$/, ""),
}));
vi.mock("../slack-secret-fingerprint", () => ({
  slackSecretFingerprint: ({ secret }: { secret: string }) =>
    `fp(${secret.trim()})`,
  slackSecretHint: ({ secret }: { secret: string }) => secret.trim().slice(-4),
}));

import type { SlackWorkspaceIdentity } from "../../delivery/slackWebApi";
import { SlackIntegrationService } from "../slack-integration.service";
import {
  FakeSlackIntegrationRepository,
  PROJECTS,
} from "./fakeSlackIntegrationRepository";

type VerifyResult =
  | { ok: true; identity: SlackWorkspaceIdentity }
  | { ok: false; error: string };

const acme: VerifyResult = {
  ok: true,
  identity: { teamId: "T-ACME", teamName: "Acme Workspace" },
};

describe("SlackIntegrationService", () => {
  let repo: FakeSlackIntegrationRepository;
  let verify: ReturnType<
    typeof vi.fn<(token: string) => Promise<VerifyResult>>
  >;
  let service: SlackIntegrationService;

  const addBot = (overrides: { secret?: string; name?: string } = {}) =>
    service.create({
      scope: PROJECTS["project-1"]!,
      name: overrides.name ?? "Alerts bot",
      kind: "BOT",
      scopeType: "ORGANIZATION",
      scopeId: "org-1",
      secret: overrides.secret ?? "xoxb-alerts-1234",
      actorId: "user-1",
    });

  beforeEach(() => {
    repo = new FakeSlackIntegrationRepository();
    verify = vi.fn(async () => acme);
    service = new SlackIntegrationService(repo, verify);
  });

  describe("create()", () => {
    describe("given a valid bot token scoped to the organization", () => {
      /** @scenario "Adding a bot connection for the organization" */
      it("stores it with the workspace Slack reported and returns no secret", async () => {
        const view = await addBot();

        expect(verify).toHaveBeenCalledWith("xoxb-alerts-1234");
        expect(view).toMatchObject({
          name: "Alerts bot",
          kind: "BOT",
          scopeType: "ORGANIZATION",
          scopeName: "Acme",
          slackTeamName: "Acme Workspace",
          secretHint: "1234",
        });
        expect(JSON.stringify(view)).not.toContain("xoxb-alerts-1234");
        await expect(
          service.findUsableSecret({ id: view.id, projectId: "project-2" }),
        ).resolves.toEqual({ kind: "BOT", token: "xoxb-alerts-1234" });
      });
    });

    describe("given an incoming webhook scoped to one project", () => {
      /** @scenario "Adding a webhook connection for one project" */
      it("shows only the last four characters and other projects cannot use it", async () => {
        const url = "https://hooks.slack.com/services/T/B/wxyz";
        const view = await service.create({
          scope: PROJECTS["project-1"]!,
          name: "Checkout alerts",
          kind: "INCOMING_WEBHOOK",
          scopeType: "PROJECT",
          scopeId: "project-1",
          secret: url,
          actorId: "user-1",
        });

        expect(view).toMatchObject({
          scopeType: "PROJECT",
          scopeName: "Checkout",
          secretHint: "wxyz",
          slackTeamId: null,
        });
        expect(verify).not.toHaveBeenCalled();
        await expect(
          service.findUsableSecret({ id: view.id, projectId: "project-1" }),
        ).resolves.toEqual({ kind: "INCOMING_WEBHOOK", url });
        await expect(
          service.findUsableSecret({ id: view.id, projectId: "project-2" }),
        ).resolves.toBeNull();
      });
    });

    describe("given a token the workspace rejects", () => {
      /** @scenario "A token Slack rejects is refused at setup" */
      it("refuses with the invalid-token code and stores nothing", async () => {
        verify.mockResolvedValue({ ok: false, error: "invalid_auth" });

        await expect(addBot()).rejects.toMatchObject({
          code: "slack_integration_invalid_token",
        });
        expect(repo.rows.size).toBe(0);
      });
    });

    describe("given Slack cannot be reached", () => {
      it("fails as infrastructure, not as a refused token", async () => {
        verify.mockResolvedValue({ ok: false, error: "request_failed" });

        const error = await addBot().catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toHaveProperty(
          "code",
          "slack_integration_invalid_token",
        );
        expect(repo.rows.size).toBe(0);
      });
    });

    describe("given the organization already stores the same token", () => {
      /** @scenario "The same secret cannot be stored twice in an organization" */
      it("refuses with the connection-exists code naming the existing connection", async () => {
        await addBot({ name: "Alerts bot" });

        await expect(addBot({ name: "Second copy" })).rejects.toMatchObject({
          code: "slack_connection_exists",
          meta: { connectionName: "Alerts bot" },
        });
        expect(repo.rows.size).toBe(1);
      });
    });
  });

  describe("listForProject()", () => {
    it("lists usable connections with how many automations use each", async () => {
      const bot = await addBot();
      repo.dependents.set(bot.id, 2);

      const { connections } = await service.listForProject({
        projectId: "project-1",
      });

      expect(connections).toEqual([
        expect.objectContaining({ id: bot.id, dependentAutomations: 2 }),
      ]);
    });
  });

  describe("update()", () => {
    describe("given a bot connection several automations deliver through", () => {
      /** @scenario "Replacing a secret needs no automation edits" */
      it("serves the new token to every automation pointing at the id", async () => {
        const bot = await addBot();
        const connection = repo.rows.get(bot.id)!;

        await service.update({
          scope: PROJECTS["project-1"]!,
          connection,
          secret: "xoxb-rotated-9999",
          actorId: "user-2",
        });

        await expect(
          service.findUsableSecret({ id: bot.id, projectId: "project-1" }),
        ).resolves.toEqual({ kind: "BOT", token: "xoxb-rotated-9999" });
        expect(repo.rows.get(bot.id)?.secretHint).toBe("9999");
      });
    });

    describe("given a rename that leaves the secret untouched", () => {
      /** @scenario "Editing a connection without retyping its secret keeps the secret" */
      it("keeps the stored secret and does not ask Slack again", async () => {
        const bot = await addBot();
        verify.mockClear();

        const view = await service.update({
          scope: PROJECTS["project-1"]!,
          connection: repo.rows.get(bot.id)!,
          name: "Renamed bot",
          actorId: "user-2",
        });

        expect(view.name).toBe("Renamed bot");
        expect(verify).not.toHaveBeenCalled();
        expect(repo.rows.get(bot.id)?.botTokenEncrypted).toBe(
          "enc(xoxb-alerts-1234)",
        );
      });
    });

    describe("given a new secret another connection already holds", () => {
      it("refuses with the connection-exists code", async () => {
        const first = await addBot({
          name: "First",
          secret: "xoxb-first-1111",
        });
        const second = await addBot({
          name: "Second",
          secret: "xoxb-second-2222",
        });

        await expect(
          service.update({
            scope: PROJECTS["project-1"]!,
            connection: repo.rows.get(second.id)!,
            secret: "xoxb-first-1111",
            actorId: "user-1",
          }),
        ).rejects.toMatchObject({
          code: "slack_connection_exists",
          meta: { connectionId: first.id },
        });
      });
    });
  });

  describe("delete()", () => {
    describe("given a connection three active automations deliver through", () => {
      /** @scenario "Deleting a connection in use says what stops delivering" */
      it("refuses with the count, then removes it once confirmed", async () => {
        const bot = await addBot();
        repo.dependents.set(bot.id, 3);
        const connection = repo.rows.get(bot.id)!;

        await expect(
          service.delete({ connection, force: false }),
        ).rejects.toMatchObject({
          code: "slack_connection_in_use",
          meta: { dependentAutomations: 3 },
        });
        expect(repo.rows.has(bot.id)).toBe(true);

        await expect(
          service.delete({ connection, force: true }),
        ).resolves.toEqual({ deleted: true, dependentAutomations: 3 });
        expect(repo.rows.has(bot.id)).toBe(false);
      });
    });
  });

  describe("findOrCreateForSecret()", () => {
    const webhook = "https://hooks.slack.com/services/T/B/abcd";

    it("creates a project connection named from the hint for a new webhook", async () => {
      const result = await service.findOrCreateForSecret({
        organizationId: "org-1",
        projectId: "project-1",
        kind: "INCOMING_WEBHOOK",
        secret: webhook,
        actorId: "user-1",
      });

      expect(result.created).toBe(true);
      expect(repo.rows.get(result.id)).toMatchObject({
        name: "Slack webhook ••••abcd",
        scopeType: "PROJECT",
        scopeId: "project-1",
      });
    });

    it("names a bot connection from its workspace, and keeps a token Slack refuses", async () => {
      const named = await service.findOrCreateForSecret({
        organizationId: "org-1",
        projectId: "project-1",
        kind: "BOT",
        secret: "xoxb-good-1234",
        actorId: "user-1",
      });
      verify.mockResolvedValue({ ok: false, error: "token_revoked" });
      const refused = await service.findOrCreateForSecret({
        organizationId: "org-1",
        projectId: "project-1",
        kind: "BOT",
        secret: "xoxb-bad-5678",
        actorId: "user-1",
      });

      expect(repo.rows.get(named.id)?.name).toBe("Acme Workspace");
      expect(repo.rows.get(refused.id)).toMatchObject({
        name: "Slack bot ••••5678",
        slackTeamId: null,
      });
    });

    it("reuses the existing connection, widening it when another project holds it", async () => {
      const first = await service.findOrCreateForSecret({
        organizationId: "org-1",
        projectId: "project-1",
        kind: "INCOMING_WEBHOOK",
        secret: webhook,
        actorId: "user-1",
      });
      const again = await service.findOrCreateForSecret({
        organizationId: "org-1",
        projectId: "project-2",
        kind: "INCOMING_WEBHOOK",
        secret: webhook,
        actorId: "user-2",
      });

      expect(again).toEqual({ id: first.id, created: false });
      expect(repo.rows.get(first.id)).toMatchObject({
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
      });
    });
  });

  describe("connectActionParams()", () => {
    describe("given a legacy webhook URL", () => {
      it("stores it as a connection and keeps no secret of its own", async () => {
        const params = await service.connectActionParams({
          projectId: "project-1",
          actorId: "user-1",
          actionParams: {
            slackWebhook: "https://hooks.slack.com/services/T/B/abcd",
          },
        });

        expect(params).toEqual({
          slackIntegrationId: expect.any(String),
          slackDelivery: "webhook",
        });
      });
    });

    describe("given a bot connection id and a contradicting delivery method", () => {
      it("derives the method from the kind and drops any legacy secret", async () => {
        const bot = await addBot();

        const params = await service.connectActionParams({
          projectId: "project-2",
          actorId: "user-1",
          actionParams: {
            slackIntegrationId: bot.id,
            slackDelivery: "webhook",
            slackChannelId: " C0123 ",
            slackWebhook: "https://hooks.slack.com/services/T/B/stale",
            slackBotToken: "xoxb-stale",
          },
        });

        expect(params).toEqual({
          slackIntegrationId: bot.id,
          slackDelivery: "bot",
          slackChannelId: "C0123",
        });
      });

      it("refuses a bot connection with no channel", async () => {
        const bot = await addBot();

        await expect(
          service.connectActionParams({
            projectId: "project-1",
            actorId: "user-1",
            actionParams: { slackIntegrationId: bot.id },
          }),
        ).rejects.toMatchObject({ code: "invalid_action_params" });
      });
    });

    describe("given a connection the project cannot use", () => {
      it("refuses with the integration-missing code", async () => {
        const url = "https://hooks.slack.com/services/T/B/only";
        const own = await service.create({
          scope: PROJECTS["project-1"]!,
          name: "Checkout only",
          kind: "INCOMING_WEBHOOK",
          scopeType: "PROJECT",
          scopeId: "project-1",
          secret: url,
          actorId: "user-1",
        });

        await expect(
          service.connectActionParams({
            projectId: "project-2",
            actorId: "user-1",
            actionParams: { slackIntegrationId: own.id },
          }),
        ).rejects.toMatchObject({ code: "slack_integration_missing" });
      });
    });

    describe("given a kept token and no connection", () => {
      it("leaves the params for the provider to keep the stored secret", async () => {
        const actionParams = {
          slackDelivery: "bot",
          slackBotToken: "__kept__",
          slackChannelId: "C1",
        };

        await expect(
          service.connectActionParams({
            projectId: "project-1",
            actorId: "user-1",
            actionParams,
          }),
        ).resolves.toBe(actionParams);
        expect(repo.rows.size).toBe(0);
      });
    });
  });
});
