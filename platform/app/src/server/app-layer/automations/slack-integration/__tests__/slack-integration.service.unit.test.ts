import { describe, expect, it, vi } from "vitest";

// Fake cipher so these tests exercise the service's orchestration — validate,
// then store, never the other way round — rather than AES itself.
vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

import type { HandledError } from "@langwatch/handled-error";
import type { SlackIntegration } from "~/generated/prisma/client";
import type { SlackWorkspaceIdentity } from "../../delivery/slackWebApi";
import type {
  ClearOwnSlackTokenOutcome,
  LegacySlackTokenAutomation,
  SlackIntegrationRepository,
} from "../repositories/slack-integration.repository";
import { SlackIntegrationService } from "../slack-integration.service";

type VerifyResult =
  | { ok: true; identity: SlackWorkspaceIdentity }
  | { ok: false; error: string };

/** In-memory stand-in for the table, so the tests can read what was actually
 *  stored — the point of most of them is that the token never leaves. */
class FakeSlackIntegrationRepository implements SlackIntegrationRepository {
  rows = new Map<string, SlackIntegration>();
  legacy: LegacySlackTokenAutomation[] = [];
  unswitchable = new Set<string>();
  clearedIds: string[] = [];
  /** Rows that exist and carry no token — the `already_clear` case. Kept apart
   *  from "no such row", which the contract calls `failed`. */
  tokenless = new Set<string>();

  async findByProject({ projectId }: { projectId: string }) {
    return this.rows.get(projectId) ?? null;
  }

  async upsertForProject(params: {
    projectId: string;
    organizationId: string;
    botTokenEncrypted: string;
    slackTeamId: string;
    slackTeamName: string;
    userId: string;
  }) {
    const now = new Date("2026-08-13T12:00:00Z");
    const row = {
      id: `slack-${params.projectId}`,
      scopeType: "PROJECT",
      scopeId: params.projectId,
      organizationId: params.organizationId,
      botTokenEncrypted: params.botTokenEncrypted,
      slackTeamId: params.slackTeamId,
      slackTeamName: params.slackTeamName,
      createdById: params.userId,
      updatedById: params.userId,
      createdAt: now,
      updatedAt: now,
    } as SlackIntegration;
    this.rows.set(params.projectId, row);
    return row;
  }

  async deleteForProject({ projectId }: { projectId: string }) {
    this.rows.delete(projectId);
  }

  async findAllWithOwnSlackToken(_params: { projectId: string }) {
    return this.legacy;
  }

  async clearOwnSlackToken({
    triggerId,
  }: {
    triggerId: string;
  }): Promise<ClearOwnSlackTokenOutcome> {
    if (this.unswitchable.has(triggerId)) return "failed";
    if (!this.legacy.some((row) => row.id === triggerId)) {
      // Mirrors the Prisma repository: a row that is simply gone is `failed`;
      // only a row that exists without a token is `already_clear`.
      return this.tokenless.has(triggerId) ? "already_clear" : "failed";
    }
    this.clearedIds.push(triggerId);
    this.legacy = this.legacy.filter((row) => row.id !== triggerId);
    return "cleared";
  }
}

const acme: VerifyResult = {
  ok: true,
  identity: { teamId: "T123", teamName: "Acme HQ" },
};

function makeService({
  repo = new FakeSlackIntegrationRepository(),
  verify = async (): Promise<VerifyResult> => acme,
}: {
  repo?: FakeSlackIntegrationRepository;
  verify?: (token: string) => Promise<VerifyResult>;
} = {}) {
  return { repo, service: new SlackIntegrationService(repo, verify) };
}

const setupInput = {
  projectId: "project-1",
  organizationId: "org-1",
  userId: "user-1",
};

describe("SlackIntegrationService", () => {
  describe("when a project manager connects Slack with a valid bot token", () => {
    /** @scenario "Connecting Slack for a project" */
    it("names the connected workspace and never hands back the token", async () => {
      const { repo, service } = makeService();

      const status = await service.setup({
        ...setupInput,
        botToken: "xoxb-live",
      });

      expect(status).toEqual({
        connected: true,
        slackTeamId: "T123",
        slackTeamName: "Acme HQ",
        connectedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(JSON.stringify(status)).not.toContain("xoxb-live");
      expect(repo.rows.get("project-1")?.botTokenEncrypted).toBe(
        "enc(xoxb-live)",
      );
    });

    /** @scenario "Connecting Slack for a project" */
    it("keeps the token out of the status read as well", async () => {
      const { service } = makeService();
      await service.setup({ ...setupInput, botToken: "xoxb-live" });

      const status = await service.getStatus({ projectId: "project-1" });

      expect(JSON.stringify(status)).not.toContain("xoxb-live");
      expect(status.slackTeamName).toBe("Acme HQ");
    });
  });

  describe("when the workspace rejects the token", () => {
    /** @scenario "A token Slack rejects is refused at setup" */
    it("refuses with the invalid-token code and stores nothing", async () => {
      const { repo, service } = makeService({
        verify: async () => ({ ok: false, error: "invalid_auth" }),
      });

      const error = await service
        .setup({ ...setupInput, botToken: "xoxb-dud" })
        .then(
          () => null,
          (thrown: unknown) => thrown,
        );

      expect((error as HandledError).code).toBe(
        "slack_integration_invalid_token",
      );
      expect(repo.rows.size).toBe(0);
    });

    /** @scenario "A token Slack rejects is refused at setup" */
    it("leaves a working connection in place when a rotation is refused", async () => {
      const repo = new FakeSlackIntegrationRepository();
      const working = new SlackIntegrationService(repo, async () => acme);
      await working.setup({ ...setupInput, botToken: "xoxb-live" });

      const rejecting = new SlackIntegrationService(repo, async () => ({
        ok: false,
        error: "token_revoked",
      }));
      await rejecting
        .setup({ ...setupInput, botToken: "xoxb-dud" })
        .catch(() => undefined);

      expect(repo.rows.get("project-1")?.botTokenEncrypted).toBe(
        "enc(xoxb-live)",
      );
    });
  });

  describe("when the token is replaced in settings", () => {
    /** @scenario "Rotating the token needs no automation edits" */
    it("serves the new token to every automation without touching one", async () => {
      const { repo, service } = makeService();
      await service.setup({ ...setupInput, botToken: "xoxb-old" });

      await service.setup({ ...setupInput, botToken: "xoxb-new" });

      expect(await service.getBotToken({ projectId: "project-1" })).toBe(
        "xoxb-new",
      );
      expect(repo.clearedIds).toEqual([]);
      expect(repo.rows.size).toBe(1);
    });
  });

  describe("when automations in the project still carry their own token", () => {
    /** @scenario "Settings counts the automations still on their own token" */
    it("counts them", async () => {
      const { repo, service } = makeService();
      repo.legacy = [
        { id: "automation-1", name: "Error spike" },
        { id: "automation-2", name: "Latency watch" },
      ];

      const automations = await service.getLegacyTokenAutomations({
        projectId: "project-1",
      });

      expect(automations).toHaveLength(2);
    });

    /** @scenario "Bulk-switching clears each automation independently" */
    it("clears the ones it can and reports the one it cannot", async () => {
      const { repo, service } = makeService();
      await service.setup({ ...setupInput, botToken: "xoxb-live" });
      repo.legacy = [
        { id: "automation-1", name: "Error spike" },
        { id: "automation-2", name: "Latency watch" },
        { id: "automation-3", name: "Cost guard" },
      ];
      repo.unswitchable.add("automation-2");

      const result = await service.clearLegacyTokens({
        projectId: "project-1",
      });

      expect(result).toEqual({ cleared: 2, alreadyClear: 0, failed: 1 });
      expect(repo.clearedIds).toEqual(["automation-1", "automation-3"]);
      // The one that failed keeps its own token, so it keeps delivering.
      expect(repo.legacy.map((row) => row.id)).toEqual(["automation-2"]);
    });

    /** @scenario "Bulk-switching clears each automation independently" */
    it("counts a row that throws as failed without stopping the batch", async () => {
      const repo = new FakeSlackIntegrationRepository();
      repo.legacy = [
        { id: "automation-1", name: "Error spike" },
        { id: "automation-2", name: "Latency watch" },
      ];
      repo.clearOwnSlackToken = async ({ triggerId }) => {
        if (triggerId === "automation-1") throw new Error("row is locked");
        return "cleared";
      };
      const service = new SlackIntegrationService(repo, async () => acme);
      await service.setup({ ...setupInput, botToken: "xoxb-live" });

      const result = await service.clearLegacyTokens({
        projectId: "project-1",
      });

      expect(result).toEqual({ cleared: 1, alreadyClear: 0, failed: 1 });
    });

    /** @scenario "Bulk-switching clears each automation independently" */
    it("reports an already-clear row as done rather than failed", async () => {
      const { repo, service } = makeService();
      await service.setup({ ...setupInput, botToken: "xoxb-live" });
      repo.legacy = [{ id: "automation-1", name: "Error spike" }];
      // Still a row, already switched over: the outcome the caller wanted.
      repo.tokenless.add("automation-already-migrated");

      const result = await service.clearLegacyTokens({
        projectId: "project-1",
        triggerIds: ["automation-1", "automation-already-migrated"],
      });

      expect(result).toEqual({ cleared: 1, alreadyClear: 1, failed: 0 });
    });

    /** @scenario "Bulk-switching clears each automation independently" */
    it("refuses to clear anything while the project has no integration", async () => {
      const { repo, service } = makeService();
      repo.legacy = [{ id: "automation-1", name: "Error spike" }];

      await expect(
        service.clearLegacyTokens({ projectId: "project-1" }),
      ).rejects.toMatchObject({ code: "slack_integration_missing" });
      expect(repo.clearedIds).toEqual([]);
    });
  });
});
