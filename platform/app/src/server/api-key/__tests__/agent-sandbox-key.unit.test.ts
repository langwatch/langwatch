/**
 * Unit coverage for the sandbox key: what it asks for, how the runs of a
 * project share it, what a failed mint does to the run, and what the sweep
 * is allowed to touch.
 *
 * Spec: specs/agent-cache/agent-cache.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { TtlCache } from "~/server/utils/ttlCache";
import {
  AGENT_SANDBOX_KEY_REUSE_MS,
  getOrMintAgentSandboxApiKey,
  mintAgentSandboxApiKey,
  reapExpiredAgentSandboxApiKeys,
  tryGetAgentSandboxApiKey,
} from "../agent-sandbox-key";
import { ApiKeyService } from "../api-key.service";
import { AGENT_SANDBOX_API_KEY_NAME } from "../reserved-names";

// Reversible stand-ins, so a test can tell what was held and can plant a
// value the real decrypt would refuse.
vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => {
    if (!value.startsWith("enc:")) throw new Error("unreadable");
    return value.slice("enc:".length);
  },
}));

const create = vi.fn();

vi.spyOn(ApiKeyService, "create").mockImplementation(
  () => ({ create }) as unknown as ApiKeyService,
);

const findUnique = vi.fn();
const prisma = { project: { findUnique } } as unknown as PrismaClient;

const SHARED_PROJECT = {
  isPersonal: false,
  ownerUserId: null,
  team: { isPersonal: false, ownerUserId: null },
};

const PERSONAL_PROJECT = {
  isPersonal: true,
  ownerUserId: "user_owner",
  team: { isPersonal: true, ownerUserId: "user_owner" },
};

describe("the agent sandbox key", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({
      token: "sk-lw-minted",
      apiKey: { id: "key_1" },
    });
    findUnique.mockReset();
    findUnique.mockResolvedValue(SHARED_PROJECT);
  });

  describe("given a project in a shared team", () => {
    describe("when a run asks for a key", () => {
      /** @scenario "A run in a shared project gets a key no user holds" */
      it("asks for the manage grain and nothing else, owned by no user", async () => {
        await mintAgentSandboxApiKey({
          prisma,
          projectId: "project_1",
          organizationId: "organization_1",
        });

        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]?.[0]).toMatchObject({
          name: AGENT_SANDBOX_API_KEY_NAME,
          isSystemManaged: true,
          userId: null,
          createdByUserId: null,
          permissionMode: "restricted",
          // Written out rather than read from the constant the code itself
          // passes: a grain added to that list has to fail here, which is the
          // whole reason this assertion exists.
          permissions: ["agentCache:manage"],
          bindings: [
            { role: "CUSTOM", scopeType: "PROJECT", scopeId: "project_1" },
          ],
        });
      });

      it("binds the key to a lifetime", async () => {
        await mintAgentSandboxApiKey({
          prisma,
          projectId: "project_1",
          organizationId: "organization_1",
        });

        const { expiresAt } = create.mock.calls[0]?.[0] as { expiresAt: Date };
        expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      });
    });
  });

  describe("given a project in a personal workspace", () => {
    describe("when a run asks for a key", () => {
      it("mints the key as the workspace owner's own credential", async () => {
        findUnique.mockResolvedValue(PERSONAL_PROJECT);

        await mintAgentSandboxApiKey({
          prisma,
          projectId: "project_personal",
          organizationId: "organization_1",
        });

        expect(findUnique).toHaveBeenCalledWith({
          where: { id: "project_personal" },
          select: {
            isPersonal: true,
            ownerUserId: true,
            team: { select: { isPersonal: true, ownerUserId: true } },
          },
        });
        expect(create.mock.calls[0]?.[0]).toMatchObject({
          userId: "user_owner",
          createdByUserId: "user_owner",
          permissions: ["agentCache:manage"],
          bindings: [
            {
              role: "CUSTOM",
              scopeType: "PROJECT",
              scopeId: "project_personal",
            },
          ],
        });
      });

      it("takes the owner from the team when the project records none", async () => {
        findUnique.mockResolvedValue({
          isPersonal: false,
          ownerUserId: null,
          team: { isPersonal: true, ownerUserId: "user_owner" },
        });

        await mintAgentSandboxApiKey({
          prisma,
          projectId: "project_personal",
          organizationId: "organization_1",
        });

        expect(create.mock.calls[0]?.[0]).toMatchObject({
          userId: "user_owner",
        });
      });

      it("leaves the key unowned when the workspace records no owner", async () => {
        findUnique.mockResolvedValue({
          isPersonal: true,
          ownerUserId: null,
          team: { isPersonal: true, ownerUserId: null },
        });

        await mintAgentSandboxApiKey({
          prisma,
          projectId: "project_personal",
          organizationId: "organization_1",
        });

        expect(create.mock.calls[0]?.[0]).toMatchObject({ userId: null });
      });
    });
  });

  describe("given a run of the project already got a key", () => {
    const freshCache = () =>
      new TtlCache<string>(AGENT_SANDBOX_KEY_REUSE_MS, "test:sandbox-key:");

    describe("when a later run of the same project asks for one", () => {
      it("is given the same key, and mints no second one", async () => {
        const cache = freshCache();

        const first = await getOrMintAgentSandboxApiKey({
          prisma,
          projectId: "project_1",
          organizationId: "organization_1",
          cache,
        });
        const second = await getOrMintAgentSandboxApiKey({
          prisma,
          projectId: "project_1",
          organizationId: "organization_1",
          cache,
        });

        expect(first).toBe("sk-lw-minted");
        expect(second).toBe(first);
        expect(create).toHaveBeenCalledTimes(1);
      });

      it("holds the shared token encrypted, never in the clear", async () => {
        const cache = freshCache();

        await getOrMintAgentSandboxApiKey({
          prisma,
          projectId: "project_1",
          organizationId: "organization_1",
          cache,
        });

        expect(await cache.get("project_1")).toBe("enc:sk-lw-minted");
      });
    });

    describe("when a run of another project asks for one", () => {
      it("mints that project its own key", async () => {
        const cache = freshCache();

        await getOrMintAgentSandboxApiKey({
          prisma,
          projectId: "project_1",
          organizationId: "organization_1",
          cache,
        });
        await getOrMintAgentSandboxApiKey({
          prisma,
          projectId: "project_2",
          organizationId: "organization_1",
          cache,
        });

        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[1]?.[0]).toMatchObject({
          bindings: [
            { role: "CUSTOM", scopeType: "PROJECT", scopeId: "project_2" },
          ],
        });
      });
    });

    describe("when the held token can no longer be read", () => {
      /** @scenario "A shared key the platform can no longer read is replaced" */
      it("mints a new key and shares that one from then on", async () => {
        const cache = freshCache();
        await cache.set("project_1", "written-before-the-secret-changed");

        const token = await getOrMintAgentSandboxApiKey({
          prisma,
          projectId: "project_1",
          organizationId: "organization_1",
          cache,
        });

        expect(token).toBe("sk-lw-minted");
        expect(create).toHaveBeenCalledTimes(1);
        expect(await cache.get("project_1")).toBe("enc:sk-lw-minted");
      });
    });
  });

  describe("given a platform that holds no shared key and cannot mint one", () => {
    describe("when a run asks for one", () => {
      /** @scenario "A run whose key could not be minted still runs" */
      it("answers with no key rather than raising", async () => {
        create.mockRejectedValue(new Error("the ledger is unreachable"));

        await expect(
          tryGetAgentSandboxApiKey({
            prisma,
            projectId: "project_1",
            organizationId: "organization_1",
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("given keys whose lifetime has passed", () => {
    describe("when the hourly sweep runs", () => {
      /** @scenario "A key whose lifetime has passed is retired" */
      it("revokes only the keys named for a sandbox run", async () => {
        const updateMany = vi.fn().mockResolvedValue({ count: 3 });
        const now = new Date("2026-01-01T00:00:00.000Z");

        const count = await reapExpiredAgentSandboxApiKeys({
          prisma: { apiKey: { updateMany } } as unknown as PrismaClient,
          now,
        });

        expect(count).toBe(3);
        expect(updateMany).toHaveBeenCalledWith({
          where: {
            name: AGENT_SANDBOX_API_KEY_NAME,
            revokedAt: null,
            expiresAt: { not: null, lte: now },
          },
          data: { revokedAt: now },
        });
      });
    });
  });
});
