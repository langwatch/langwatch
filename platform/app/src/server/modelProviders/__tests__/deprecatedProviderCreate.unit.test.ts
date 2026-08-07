/**
 * A deprecated provider is one that has been absorbed into another. Its
 * stored rows keep working — that is what stops a deployment mid-fold
 * being stranded — but its population has to be able to reach zero, or
 * the compatibility entry can never be deleted.
 *
 * The Add menu hiding the tile does not achieve that: a direct tRPC call,
 * an SDK, or a page open since before the change would keep minting rows.
 * These drive the real service so the refusal is proven where it has to
 * live, and so the still-allowed edit path is proven alongside it.
 *
 * Covers @unit scenarios from
 * specs/model-providers/google-agent-platform.feature.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ModelProviderService } from "../modelProvider.service";

const STORED_ROW = {
  id: "mp_legacy",
  name: "Google Agent Platform",
  provider: "google_agent_platform",
  organizationId: "org_acme",
  enabled: true,
  customKeys: null,
  customModels: null,
  customEmbeddingsModels: null,
  extraHeaders: null,
  deploymentMapping: null,
  scopes: [{ scopeType: "PROJECT", scopeId: "project_acme", id: "s_1" }],
};

/**
 * Enough Prisma for the write path: the row lookup an edit resolves
 * through, and an update that records what it was asked to write.
 */
const fakePrisma = ({ existingRow }: { existingRow: object | null }) => {
  const update = vi.fn(async (args: unknown) => args);
  return {
    prisma: {
      modelProvider: {
        findFirst: vi.fn(async () => existingRow),
        findMany: vi.fn(async () => []),
        update,
      },
      project: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
    } as unknown as PrismaClient,
    update,
  };
};

describe("adding a credential under a deprecated provider", () => {
  describe("given no row exists yet — this is a create", () => {
    /** @scenario The retired provider accepts no new credentials, from anywhere */
    it("refuses, and names the provider to use instead", async () => {
      const { prisma, update } = fakePrisma({ existingRow: null });
      const service = ModelProviderService.create(prisma);

      const call = service.updateModelProvider({
        projectId: "project_acme",
        provider: "google_agent_platform",
        enabled: true,
        customKeys: {
          GOOGLE_AGENT_PLATFORM_API_KEY: "AQ.key",
          GOOGLE_AGENT_PLATFORM_PROJECT: "acme-123",
          GOOGLE_AGENT_PLATFORM_LOCATION: "global",
        },
      });

      await expect(call).rejects.toMatchObject({
        code: "model_provider_deprecated",
        meta: { provider: "google_agent_platform", replacement: "gemini" },
      });
      // Nothing was written: a refusal that still created the row would
      // defeat the point of refusing.
      expect(update).not.toHaveBeenCalled();
    });

    /** @scenario The retired provider accepts no new credentials, from anywhere */
    it("still allows a create under the provider that absorbed it", async () => {
      const { prisma } = fakePrisma({ existingRow: null });
      const service = ModelProviderService.create(prisma);

      // Reaches past the deprecation guard — it fails later, on the
      // fake's missing plumbing, which is exactly the point: the guard
      // did not stop it.
      const call = service.updateModelProvider({
        projectId: "project_acme",
        provider: "gemini",
        enabled: true,
        customKeys: { GEMINI_API_KEY: "AIza.key" },
      });

      await expect(call).rejects.not.toMatchObject({
        code: "model_provider_deprecated",
      });
    });
  });

  describe("given the row is already stored", () => {
    /** @scenario An already-stored credential under the retired provider can still be changed */
    it("lets the caller change it, so a deployment mid-fold is never stranded", async () => {
      const { prisma } = fakePrisma({ existingRow: STORED_ROW });
      const service = ModelProviderService.create(prisma);

      const call = service.updateModelProvider({
        id: "mp_legacy",
        organizationId: "org_acme",
        provider: "google_agent_platform",
        enabled: false,
      });

      await expect(call).rejects.not.toMatchObject({
        code: "model_provider_deprecated",
      });
    });
  });
});
