/**
 * Unit coverage for the run-scoped sandbox key mint: what it asks for, and
 * what a failed mint does to the run.
 *
 * Spec: specs/agent-cache/agent-cache.feature
 */

import { AGENT_SANDBOX_API_KEY_NAME, type ApiKeyService } from "@langwatch/api-key-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mintAgentSandboxApiKey,
  tryMintAgentSandboxApiKey,
} from "../agent-sandbox-key-mint.service";

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

  describe("given a project in a shared team", () => {
    describe("when a run asks for a key", () => {
      /** @scenario "A run in a shared project gets a key no user holds" */
      it("asks for the manage grain and nothing else, owned by no user", async () => {
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
          createdByUserId: null,
          permissionMode: "restricted",
          // Written out rather than read from the constant the code itself
          // passes: a grain added to that list has to fail here, which is the
          // whole reason this assertion exists.
          permissions: ["agentCache:manage"],
          bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "project_1" }],
        });
      });

      it("binds the key to a lifetime", async () => {
        await mintAgentSandboxApiKey({
          apiKeys,
          projectId: "project_1",
          organizationId: "organization_1",
        });

        const createCall = create.mock.calls[0];
        if (!createCall) throw new Error("create was never called");
        const { expiresAt } = createCall[0] as { expiresAt: Date };
        expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      });
    });
  });

  describe("given a platform that holds no shared key and cannot mint one", () => {
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
});
