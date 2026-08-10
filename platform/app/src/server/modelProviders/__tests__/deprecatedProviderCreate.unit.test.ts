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
 *
 * The transaction hands back the SAME `update` mock the outer client
 * carries, because the repository writes through the transaction client.
 * Handing `fn` an empty object instead is what let the allowed-edit test
 * pass on a `TypeError: Cannot read properties of undefined (reading
 * 'update')` from this stub — a rejection that proves only that the
 * deprecation guard did not fire, never that the edit lands.
 */
const fakePrisma = ({ existingRow }: { existingRow: object | null }) => {
  const update = vi.fn(async (args: { data?: unknown }) => ({
    ...existingRow,
    ...(args.data as object),
    scopes: [],
  }));
  const modelProvider = {
    findFirst: vi.fn(async () => existingRow),
    findUnique: vi.fn(async () => existingRow),
    findMany: vi.fn(async () => []),
    update,
  };
  const create = vi.fn(async (args: { data?: unknown }) => ({
    id: "mp_new",
    ...(args.data as object),
    scopes: [],
  }));
  // A create resolves the organization a PROJECT scope belongs to before
  // it inserts (the single-organization anchor, ADR-021), so the tenancy
  // tables have to answer inside the transaction too.
  const TENANT = { organizationId: "org_acme" };
  const tx = {
    modelProvider: { ...modelProvider, create },
    modelProviderScope: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    project: {
      findUnique: vi.fn(async () => ({
        id: "project_acme",
        teamId: "team_acme",
        team: TENANT,
      })),
      findMany: vi.fn(async () => [
        { id: "project_acme", teamId: "team_acme", team: TENANT },
      ]),
    },
    team: {
      findUnique: vi.fn(async () => ({ id: "team_acme", ...TENANT })),
      findMany: vi.fn(async () => [{ id: "team_acme", ...TENANT }]),
    },
    organization: {
      findUnique: vi.fn(async () => ({ id: "org_acme" })),
      findMany: vi.fn(async () => [{ id: "org_acme" }]),
    },
  };
  return {
    prisma: {
      modelProvider,
      project: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaClient,
    update,
    create,
  };
};

describe("adding a credential under a deprecated provider", () => {
  describe("given no row exists yet — this is a create", () => {
    /** @scenario The retired provider accepts no new credentials, from anywhere */
    it("refuses, and names the provider to use instead", async () => {
      const { prisma, update, create } = fakePrisma({ existingRow: null });
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
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    /** @scenario The retired provider accepts no new credentials, from anywhere */
    it("still allows a create under the provider that absorbed it", async () => {
      const { prisma, create } = fakePrisma({ existingRow: null });
      const service = ModelProviderService.create(prisma);

      // The onboarding seed that runs after the insert wants plumbing
      // this fake does not carry, so the call may still reject — the row
      // write is recorded either way, and reaching it is the claim.
      await service
        .updateModelProvider({
          projectId: "project_acme",
          provider: "gemini",
          enabled: true,
          customKeys: { GEMINI_API_KEY: "AIza.key" },
        })
        .catch(() => undefined);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ provider: "gemini" }),
        }),
      );
    });
  });

  describe("given the row is already stored", () => {
    /** @scenario An already-stored credential under the retired provider can still be changed */
    it("lets the caller change it, so a deployment mid-fold is never stranded", async () => {
      const { prisma, update } = fakePrisma({ existingRow: STORED_ROW });
      const service = ModelProviderService.create(prisma);

      await service.updateModelProvider({
        id: "mp_legacy",
        organizationId: "org_acme",
        provider: "google_agent_platform",
        enabled: false,
      });

      // Asserting the write LANDED, not merely that it failed with some
      // other error: "the guard did not fire" and "the edit works" are
      // different claims, and only the second one is the promise that
      // keeps a mid-fold deployment usable.
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mp_legacy" },
          data: expect.objectContaining({ enabled: false }),
        }),
      );
    });
  });
});
