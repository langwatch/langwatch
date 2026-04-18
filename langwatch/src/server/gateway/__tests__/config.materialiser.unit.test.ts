import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { GatewayConfigMaterialiser } from "../config.materialiser";
import type { VirtualKeyWithChain } from "../virtualKey.repository";

function stubVk(
  overrides: Partial<VirtualKeyWithChain> = {},
): VirtualKeyWithChain {
  return {
    id: "vk_01",
    projectId: "project_01",
    name: "test key",
    description: null,
    environment: "LIVE",
    status: "ACTIVE",
    hashedSecret: "a".repeat(64),
    previousHashedSecret: null,
    previousSecretExpiresAt: null,
    displayPrefix: "lw_vk_live_01HZX",
    principalUserId: null,
    revision: 42n,
    config: { modelAliases: {}, metadata: {} } as any,
    lastUsedAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: "user_01",
    rotatedAt: null,
    rotatedById: null,
    revokedAt: null,
    revokedById: null,
    providerCredentials: [],
    ...overrides,
  } as VirtualKeyWithChain;
}

function mockPrisma(partial: Partial<PrismaClient>): PrismaClient {
  return partial as PrismaClient;
}

describe("GatewayConfigMaterialiser", () => {
  describe("when assembling the config bundle", () => {
    it("serialises the revision as a string and flattens project→team→org ids", async () => {
      const prisma = mockPrisma({
        project: {
          findUnique: async () => ({
            id: "project_01",
            teamId: "team_01",
            name: "p",
            slug: "p",
            team: {
              id: "team_01",
              name: "t",
              organizationId: "org_01",
              slug: "t",
            },
          }),
        } as any,
        gatewayProviderCredential: {
          findMany: async () => [],
        } as any,
        gatewayBudget: {
          findMany: async () => [],
        } as any,
      });
      const sut = new GatewayConfigMaterialiser(prisma);

      const bundle = await sut.materialise(stubVk());

      expect(bundle.revision).toBe("42");
      expect(bundle.vk_id).toBe("vk_01");
      expect(bundle.project_id).toBe("project_01");
      expect(bundle.team_id).toBe("team_01");
      expect(bundle.organization_id).toBe("org_01");
      expect(bundle.environment).toBe("live");
      expect(bundle.status).toBe("active");
      expect(bundle.display_prefix).toBe("lw_vk_live_01HZX");
    });

    it("maps revoked status to 'revoked'", async () => {
      const prisma = mockPrisma({
        project: {
          findUnique: async () => ({
            id: "project_01",
            teamId: "team_01",
            name: "p",
            slug: "p",
            team: { id: "team_01", name: "t", organizationId: "org_01" },
          }),
        } as any,
        gatewayProviderCredential: { findMany: async () => [] } as any,
        gatewayBudget: { findMany: async () => [] } as any,
      });
      const sut = new GatewayConfigMaterialiser(prisma);

      const bundle = await sut.materialise(stubVk({ status: "REVOKED" }));

      expect(bundle.status).toBe("revoked");
    });

    it("preserves provider chain ordering declared on the VK", async () => {
      const chain = [
        { providerCredentialId: "pc_primary", priority: 0 },
        { providerCredentialId: "pc_fallback", priority: 1 },
      ];
      const prisma = mockPrisma({
        project: {
          findUnique: async () => ({
            id: "project_01",
            teamId: "team_01",
            name: "p",
            slug: "p",
            team: { id: "team_01", name: "t", organizationId: "org_01" },
          }),
        } as any,
        gatewayProviderCredential: {
          findMany: async () => [
            // DB returns in arbitrary order — materialiser must re-sort.
            {
              id: "pc_fallback",
              slot: "fallback_1",
              rateLimitRpm: null,
              rateLimitTpm: null,
              rateLimitRpd: null,
              healthStatus: "HEALTHY",
              circuitOpenedAt: null,
              providerConfig: null,
              modelProvider: {
                provider: "anthropic",
                customKeys: null,
                deploymentMapping: null,
              },
            },
            {
              id: "pc_primary",
              slot: "primary",
              rateLimitRpm: null,
              rateLimitTpm: null,
              rateLimitRpd: null,
              healthStatus: "HEALTHY",
              circuitOpenedAt: null,
              providerConfig: null,
              modelProvider: {
                provider: "openai",
                customKeys: null,
                deploymentMapping: null,
              },
            },
          ],
        } as any,
        gatewayBudget: { findMany: async () => [] } as any,
      });
      const sut = new GatewayConfigMaterialiser(prisma);

      const bundle = await sut.materialise(
        stubVk({ providerCredentials: chain as any }),
      );

      expect(bundle.providers.map((p) => p.credentials_ref)).toEqual([
        "pc_primary",
        "pc_fallback",
      ]);
      expect(bundle.providers[0]?.type).toBe("openai");
      expect(bundle.fallback.chain).toEqual(["pc_primary", "pc_fallback"]);
    });

    it("renders budget amounts as fixed-precision strings for JSON fidelity", async () => {
      const prisma = mockPrisma({
        project: {
          findUnique: async () => ({
            id: "project_01",
            teamId: "team_01",
            name: "p",
            slug: "p",
            team: { id: "team_01", name: "t", organizationId: "org_01" },
          }),
        } as any,
        gatewayProviderCredential: { findMany: async () => [] } as any,
        gatewayBudget: {
          findMany: async () => [
            {
              id: "b_01",
              scopeType: "PROJECT",
              scopeId: "project_01",
              window: "MONTH",
              limitUsd: { toString: () => "1000.000000" },
              spentUsd: { toString: () => "125.500000" },
              resetsAt: new Date("2026-05-01T00:00:00Z"),
              onBreach: "BLOCK",
            },
          ],
        } as any,
      });
      const sut = new GatewayConfigMaterialiser(prisma);

      const bundle = await sut.materialise(stubVk());

      expect(bundle.budgets).toHaveLength(1);
      expect(bundle.budgets[0]).toMatchObject({
        id: "b_01",
        scope: "project",
        window: "month",
        limit_usd: "1000.000000",
        spent_usd: "125.500000",
        remaining_usd: "874.500000",
        on_breach: "block",
      });
    });

    describe("when the project is missing", () => {
      it("throws a descriptive error", async () => {
        const prisma = mockPrisma({
          project: { findUnique: async () => null } as any,
          gatewayProviderCredential: { findMany: async () => [] } as any,
          gatewayBudget: { findMany: async () => [] } as any,
        });
        const sut = new GatewayConfigMaterialiser(prisma);

        await expect(sut.materialise(stubVk())).rejects.toThrow(
          /project .* not found/,
        );
      });
    });
  });
});
