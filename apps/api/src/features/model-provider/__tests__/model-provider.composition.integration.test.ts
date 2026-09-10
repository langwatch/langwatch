/**
 * The provider surfaces, installed by the API process.
 *
 * The module boots in the `api` role over this process's own selection, and
 * the app it provides is the one `ctx.app.modelProviders` is read from. There
 * is no refusing twin to fall back to: a process installs the module or names
 * what it is missing at boot.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SecretEncryption } from "@langwatch/secret-server";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { installApiModelProvider } from "../model-provider.composition.ts";

const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";

/** The rows this module reads, as a double: nothing here reaches a database. */
function testPrisma() {
  return {
    modelProvider: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
    },
    modelDefaultConfig: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    modelDefaultConfigScope: { findMany: vi.fn(async () => []) },
    customLLMModelCost: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    gatewayChangeEvent: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(),
  };
}

/** The one project row the scope derivation reads. */
function testProject() {
  return {
    id: PROJECT_ID,
    teamId: "team-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    team: { id: "team-1", organizationId: ORGANIZATION_ID },
  };
}

/** A cipher that is present and reversible; the format is not under test here. */
function testEncryption(): SecretEncryption {
  return {
    encrypt: (value: string) => `sealed:${value}`,
    decrypt: (value: string) => value.replace(/^sealed:/, ""),
  } as SecretEncryption;
}

function installOver(prisma: ReturnType<typeof testPrisma>) {
  return installApiModelProvider({
    prisma: prisma as unknown as PrismaClient,
    projects: createApiFixture<ProjectApi>({
      getWithTeam: async () => testProject(),
      tryGetWithTeam: async () => testProject(),
    }),
    organizations: createApiFixture<OrganizationApi>(),
    authorization: createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
    encryption: testEncryption(),
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    environment: {},
    isSaas: false,
    egress: { blockLocal: true, allowedHosts: [], verifyTls: true },
    nlpServiceUrl: undefined,
    processName: "langwatch-api",
  });
}

describe("given the API process installs the model-provider module", () => {
  describe("when it boots in the api role", () => {
    it("provides the app the provider surfaces are read from", async () => {
      const composed = await installOver(testPrisma());

      expect(typeof composed.app.listForProject).toBe("function");
      expect(typeof composed.app.listCosts).toBe("function");
      expect(typeof composed.app.translate).toBe("function");
    });

    it("reads a project's cost rules through its own repositories", async () => {
      const prisma = testPrisma();
      const composed = await installOver(prisma);

      const costs = await composed.app.listCosts({ projectId: PROJECT_ID });

      expect(costs).toEqual([]);
      expect(prisma.customLLMModelCost.findMany).toHaveBeenCalled();
    });

    it("answers the registry's ceilings without reaching a database at all", async () => {
      const composed = await installOver(testPrisma());

      expect(composed.app.findModelLimits({ model: "not-a-model" })).toBeNull();
    });
  });
});
