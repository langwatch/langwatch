/**
 * Unit coverage for the run-scoped sandbox key: what it asks for, what a
 * failed mint does to the run, and what the sweep is allowed to touch.
 *
 * Spec: specs/agent-cache/agent-cache.feature
 */

import {
  AGENT_SANDBOX_API_KEY_NAME,
  type ApiKeyService,
} from "@langwatch/api-key-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  mintAgentSandboxApiKey,
  reapExpiredAgentSandboxApiKeys,
  tryMintAgentSandboxApiKey,
} from "../agent-sandbox-key";

const create = vi.fn();

// The mint takes the composed capability now rather than building one from a
// Prisma client, so the double is the capability itself and no module needs
// spying on.
const apiKeys = { create } as unknown as ApiKeyService;

describe("the agent sandbox key", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({
      token: "sk-lw-minted",
      apiKey: { id: "key_1" },
    });
  });

  describe("given a project that can mint a key", () => {
    describe("when a run asks for one", () => {
      it("asks for the manage grain and nothing else", async () => {
        await mintAgentSandboxApiKey({
          apiKeys,
          projectId: "project_1",
          organizationId: "organization_1",
        });

        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]?.[0]).toMatchObject({
          name: AGENT_SANDBOX_API_KEY_NAME,
          isSystemManaged: true,
          userId: null,
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
          apiKeys,
          projectId: "project_1",
          organizationId: "organization_1",
        });

        const { expiresAt } = create.mock.calls[0]?.[0] as { expiresAt: Date };
        expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      });
    });
  });

  describe("given a platform that cannot mint a key", () => {
    describe("when a run asks for one", () => {
      /** @scenario "A run whose key could not be minted still runs" */
      it("answers with no key rather than raising", async () => {
        create.mockRejectedValue(new Error("the ledger is unreachable"));

        await expect(
          tryMintAgentSandboxApiKey({
            apiKeys,
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
