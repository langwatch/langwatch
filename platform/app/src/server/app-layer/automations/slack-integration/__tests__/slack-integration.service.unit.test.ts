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
import {
  SlackIntegrationService,
  withKeptLegacySlackSecret,
} from "../slack-integration.service";
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

  const addProjectWebhook = ({
    projectId,
    secret,
  }: {
    projectId: string;
    secret: string;
  }) =>
    service.create({
      scope: PROJECTS[projectId]!,
      name: `${projectId} alerts`,
      kind: "INCOMING_WEBHOOK",
      scopeType: "PROJECT",
      scopeId: projectId,
      secret,
      actorId: "user-1",
    });

  const saveLegacy = ({
    projectId,
    kind = "INCOMING_WEBHOOK",
    secret,
  }: {
    projectId: string;
    kind?: "BOT" | "INCOMING_WEBHOOK";
    secret: string;
  }) =>
    service.findOrCreateForSecret({
      organizationId: "org-1",
      projectId,
      kind,
      secret,
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

    describe("given the same scope already stores the same token", () => {
      /** @scenario "The same secret cannot be stored twice in one scope" */
      it("refuses with the connection-exists code naming the existing connection", async () => {
        await addBot({ name: "Alerts bot" });

        await expect(addBot({ name: "Second copy" })).rejects.toMatchObject({
          code: "slack_connection_exists",
          meta: { connectionName: "Alerts bot" },
        });
        expect(repo.rows.size).toBe(1);
      });
    });

    describe("given the organization holds the token a project connection is added with", () => {
      /** @scenario "A project connection is refused when its organization already holds the secret" */
      it("refuses with the connection-exists code naming the organization connection", async () => {
        await addBot({ name: "Alerts bot" });

        await expect(
          service.create({
            scope: PROJECTS["project-1"]!,
            name: "Checkout copy",
            kind: "BOT",
            scopeType: "PROJECT",
            scopeId: "project-1",
            secret: "xoxb-alerts-1234",
            actorId: "user-1",
          }),
        ).rejects.toMatchObject({
          code: "slack_connection_exists",
          meta: { connectionName: "Alerts bot" },
        });
        expect(repo.rows.size).toBe(1);
      });
    });

    describe("given only another project holds the webhook URL", () => {
      const url = "https://hooks.slack.com/services/T/B/shared";

      /** @scenario "A secret only another project holds can still be stored for this project" */
      it("stores a project connection for this project and leaves the other as it was", async () => {
        const other = await addProjectWebhook({
          projectId: "project-2",
          secret: url,
        });
        const before = repo.rows.get(other.id);

        const own = await addProjectWebhook({
          projectId: "project-1",
          secret: url,
        });

        expect(own).toMatchObject({
          scopeType: "PROJECT",
          scopeId: "project-1",
        });
        expect(own.id).not.toBe(other.id);
        expect(repo.rows.get(other.id)).toEqual(before);
      });
    });

    describe("given projects that each hold a webhook URL as a legacy secret", () => {
      const url = "https://hooks.slack.com/services/T/B/everyone";

      /** @scenario "Only an explicit organization-scoped create makes an organization connection" */
      it("stays project-scoped until an organization connection is created explicitly", async () => {
        const first = await saveLegacy({ projectId: "project-1", secret: url });
        const second = await saveLegacy({
          projectId: "project-2",
          secret: url,
        });
        const projectRows = [...repo.rows.values()];

        expect(first.id).not.toBe(second.id);
        expect(projectRows.map((row) => row.scopeType)).toEqual([
          "PROJECT",
          "PROJECT",
        ]);

        const shared = await service.create({
          scope: PROJECTS["project-1"]!,
          name: "Everyone",
          kind: "INCOMING_WEBHOOK",
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          secret: url,
          actorId: "user-1",
        });

        expect(shared.scopeType).toBe("ORGANIZATION");
        for (const row of projectRows) {
          expect(repo.rows.get(row.id)).toEqual(row);
        }
      });
    });
  });

  describe("listForProject()", () => {
    it("lists usable connections with how many automations use each", async () => {
      const bot = await addBot();
      repo.dependents.set(bot.id, ["project-1", "project-2"]);

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

    describe("given an organization connection another project's automations use", () => {
      /** @scenario "Narrowing an organization connection other projects use is confirmed first" */
      it("refuses narrowing with their count, then narrows once forced", async () => {
        const bot = await addBot();
        repo.dependents.set(bot.id, ["project-1", "project-2", "project-2"]);
        const narrow = (force?: boolean) =>
          service.update({
            scope: PROJECTS["project-1"]!,
            connection: repo.rows.get(bot.id)!,
            scopeType: "PROJECT",
            scopeId: "project-1",
            actorId: "user-1",
            force,
          });

        await expect(narrow()).rejects.toMatchObject({
          code: "slack_connection_in_use",
          meta: { dependentAutomations: 2 },
        });
        expect(repo.rows.get(bot.id)?.scopeType).toBe("ORGANIZATION");

        await expect(narrow(true)).resolves.toMatchObject({
          scopeType: "PROJECT",
          scopeId: "project-1",
        });
      });

      it("narrows without asking when only this project's automations use it", async () => {
        const bot = await addBot();
        repo.dependents.set(bot.id, ["project-1"]);

        await expect(
          service.update({
            scope: PROJECTS["project-1"]!,
            connection: repo.rows.get(bot.id)!,
            scopeType: "PROJECT",
            scopeId: "project-1",
            actorId: "user-1",
          }),
        ).resolves.toMatchObject({ scopeType: "PROJECT" });
      });
    });

    describe("given a move into a scope that already holds its secret", () => {
      it("refuses with the connection-exists code and leaves both in place", async () => {
        const url = "https://hooks.slack.com/services/T/B/move";
        const own = await addProjectWebhook({
          projectId: "project-2",
          secret: url,
        });
        const shared = await service.create({
          scope: PROJECTS["project-1"]!,
          name: "Shared",
          kind: "INCOMING_WEBHOOK",
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          secret: url,
          actorId: "user-1",
        });

        await expect(
          service.update({
            scope: PROJECTS["project-2"]!,
            connection: repo.rows.get(own.id)!,
            scopeType: "ORGANIZATION",
            scopeId: "org-1",
            actorId: "user-1",
          }),
        ).rejects.toMatchObject({
          code: "slack_connection_exists",
          meta: { connectionId: shared.id },
        });
        expect(repo.rows.get(own.id)?.scopeType).toBe("PROJECT");
      });
    });
  });

  describe("delete()", () => {
    describe("given a connection three active automations deliver through", () => {
      /** @scenario "Deleting a connection in use says what stops delivering" */
      it("refuses with the count, then removes it once confirmed", async () => {
        const bot = await addBot();
        repo.dependents.set(bot.id, ["project-1", "project-1", "project-2"]);
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
      const result = await saveLegacy({
        projectId: "project-1",
        secret: webhook,
      });

      expect(result.wasCreated).toBe(true);
      expect(repo.rows.get(result.id)).toMatchObject({
        name: "Slack webhook ••••abcd",
        scopeType: "PROJECT",
        scopeId: "project-1",
      });
    });

    it("names a bot connection from its workspace, and keeps a token Slack refuses", async () => {
      const named = await saveLegacy({
        projectId: "project-1",
        kind: "BOT",
        secret: "xoxb-good-1234",
      });
      verify.mockResolvedValue({ ok: false, error: "token_revoked" });
      const refused = await saveLegacy({
        projectId: "project-1",
        kind: "BOT",
        secret: "xoxb-bad-5678",
      });

      expect(repo.rows.get(named.id)?.name).toBe("Acme Workspace");
      expect(repo.rows.get(refused.id)).toMatchObject({
        name: "Slack bot ••••5678",
        slackTeamId: null,
      });
    });

    it("reuses the project's own connection on a second save", async () => {
      const first = await saveLegacy({
        projectId: "project-1",
        secret: webhook,
      });

      const again = await saveLegacy({
        projectId: "project-1",
        secret: webhook,
      });

      expect(again).toEqual({ id: first.id, wasCreated: false });
      expect(repo.rows.size).toBe(1);
    });

    describe("given only another project holds the secret", () => {
      /** @scenario "A legacy secret held only by another project creates a connection for this project" */
      it("creates a project connection for this project and never widens the other", async () => {
        const other = await saveLegacy({
          projectId: "project-2",
          secret: webhook,
        });
        const before = repo.rows.get(other.id);

        const own = await saveLegacy({
          projectId: "project-1",
          secret: webhook,
        });

        expect(own.wasCreated).toBe(true);
        expect(own.id).not.toBe(other.id);
        expect(repo.rows.get(own.id)).toMatchObject({
          scopeType: "PROJECT",
          scopeId: "project-1",
        });
        expect(repo.rows.get(other.id)).toEqual(before);
        expect(repo.rows.get(other.id)).toMatchObject({
          scopeType: "PROJECT",
          scopeId: "project-2",
        });
      });
    });

    describe("given an organization connection holds the secret", () => {
      /** @scenario "A legacy secret this project can already use reuses that connection" */
      it("points at the organization connection and changes nothing", async () => {
        const shared = await addBot();
        const before = new Map(repo.rows);

        const result = await saveLegacy({
          projectId: "project-2",
          kind: "BOT",
          secret: "xoxb-alerts-1234",
        });

        expect(result).toEqual({ id: shared.id, wasCreated: false });
        expect(repo.rows).toEqual(before);
      });
    });

    describe("given a concurrent save stores the secret into this project first", () => {
      /** @scenario "Two saves of one legacy secret racing in one project share one connection" */
      it("answers the row stored first without changing any scope", async () => {
        const other = await saveLegacy({
          projectId: "project-2",
          secret: webhook,
        });
        const rival = await saveLegacy({
          projectId: "project-1",
          secret: webhook,
        });
        const before = new Map(repo.rows);
        const lookups = vi.spyOn(repo, "findAllByFingerprint");
        lookups.mockResolvedValueOnce([]);

        const result = await saveLegacy({
          projectId: "project-1",
          secret: webhook,
        });

        expect(result).toEqual({ id: rival.id, wasCreated: false });
        expect(lookups).toHaveBeenCalledTimes(2);
        expect(repo.rows).toEqual(before);
        expect(repo.rows.get(other.id)?.scopeType).toBe("PROJECT");
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

    describe("given a legacy bot token and no channel", () => {
      it("refuses before storing any connection", async () => {
        await expect(
          service.connectActionParams({
            projectId: "project-1",
            actorId: "user-1",
            actionParams: { slackDelivery: "bot", slackBotToken: "xoxb-new-1" },
          }),
        ).rejects.toMatchObject({ code: "invalid_action_params" });
        expect(repo.rows.size).toBe(0);
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

describe("withKeptLegacySlackSecret", () => {
  // Built at runtime so no fixture reads as a real credential.
  const token = ["xoxb", "fake", "kept"].join("-");
  const url = ["https://hooks.slack.com", "services", "fake"].join("/");

  describe("given a bot row not yet migrated saved without its token", () => {
    /** @scenario Editing a bot automation without re-entering the token */
    it("puts the stored token back for the save to move", () => {
      for (const slackBotToken of [undefined, "", "__kept__", "[redacted]"]) {
        expect(
          withKeptLegacySlackSecret({
            actionParams: {
              slackDelivery: "bot",
              slackChannelId: "C1",
              slackBotToken,
            },
            stored: { slackDelivery: "bot", slackBotToken: `enc(${token})` },
          }),
        ).toMatchObject({ slackBotToken: token });
      }
    });
  });

  describe("given a webhook row not yet migrated written back as read", () => {
    it("puts the stored URL back for the save to move", () => {
      expect(
        withKeptLegacySlackSecret({
          actionParams: { slackDelivery: "webhook" },
          stored: { slackWebhook: url },
        }),
      ).toEqual({ slackDelivery: "webhook", slackWebhook: url });
    });
  });

  describe("given a save that types its own secret or names a connection", () => {
    it("leaves the save as it is", () => {
      const typed = { slackDelivery: "webhook", slackWebhook: `${url}/new` };
      const named = { slackIntegrationId: "conn-1" };
      const stored = { slackWebhook: url };
      expect(withKeptLegacySlackSecret({ actionParams: typed, stored })).toBe(
        typed,
      );
      expect(withKeptLegacySlackSecret({ actionParams: named, stored })).toBe(
        named,
      );
    });
  });

  describe("given a stored row already on a connection, or none", () => {
    it("adds nothing", () => {
      const save = { slackDelivery: "webhook" };
      for (const stored of [
        undefined,
        { slackIntegrationId: "conn-1", slackWebhook: url },
      ]) {
        expect(withKeptLegacySlackSecret({ actionParams: save, stored })).toBe(
          save,
        );
      }
    });
  });

  describe("given a stored token it cannot read", () => {
    it("adds nothing, so the save stores no secret", () => {
      const save = { slackDelivery: "bot", slackChannelId: "C1" };
      expect(
        withKeptLegacySlackSecret({
          actionParams: save,
          stored: { slackDelivery: "bot", slackBotToken: 42 },
        }),
      ).toBe(save);
    });
  });
});
