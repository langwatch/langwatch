/**
 * The model gateway this process composes for itself, driven through the
 * packaged service.
 *
 * What this pins is the WIRING of the six ports
 * `PostgresModelProviderAdapter` takes, because every one of them used to be a
 * `platform/app` class and the option that carried them was never supplied.
 * Nothing between the service and the row is stubbed: the repositories, the
 * catalogue, the credential codec and the connection limiter are the real,
 * packaged ones. The doubles are at the seams this PROCESS owns — the Prisma
 * client, the project and organization reads, the stored-secret cipher and the
 * fixed-window counter.
 *
 * Three things are worth a test here and each is a port that could be wired to
 * the wrong thing without anything failing loudly:
 *
 *   the CIPHER        a provider credential is stored encrypted, so a gateway
 *                     holding a different cipher than the rest of the
 *                     deployment reports every configured provider as unusable
 *                     rather than failing;
 *   the COUNTER       the connection test is bounded by two windows, and a
 *                     limiter wired to nothing would let a caller spend an
 *                     organization's key at machine speed;
 *   the DEPLOYMENT    a system provider is credentialed by LangWatch's own
 *                     environment and may only ever be enabled on the hosted
 *                     install.
 */
import {
  ModelProviderTestRateLimitedError,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService, ProjectWithTeam } from "@langwatch/project-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { describe, expect, it, vi } from "vitest";
import { composeApiModelProviders } from "../api-model-provider.composition";

/** The one provider row these scenarios read, with its credentials at rest. */
function providerRow(customKeys: unknown) {
  return {
    id: "model_provider_1",
    organizationId: "org-1",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    routingHandle: null,
    scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
    customKeys,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    rotationPolicy: "MANUAL",
    providerConfig: null,
    deploymentMapping: null,
    healthStatus: "UNKNOWN",
    circuitOpenedAt: null,
    lastHealthCheckAt: null,
    disabledAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

/**
 * The cipher the deployment writes credentials with.
 *
 * A marker rather than AES: the algorithm has its own suite, and what is under
 * test is that the gateway was given the deployment's cipher at all — a
 * credential written with one and read with another decrypts to nothing.
 */
function testCipher(): SecretEncryptionPort {
  return {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => {
      if (!value.startsWith("enc:")) throw new Error("Invalid encrypted string format");
      return value.slice("enc:".length);
    },
  } as SecretEncryptionPort;
}

function testProjects(): ProjectService {
  const project = {
    id: "project-1",
    name: "Support",
    slug: "support",
    teamId: "team-1",
    team: { id: "team-1", name: "Core", organizationId: "org-1" },
    // The date a system provider's availability is judged against: a provider
    // is offered to projects created after LangWatch started credentialing it.
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  } as unknown as ProjectWithTeam;

  return {
    getWithTeam: async () => project,
    tryGetWithTeam: async () => project,
  } as unknown as ProjectService;
}

function testOrganizations(): OrganizationService {
  return {
    getBillingProfile: async () => ({ id: "org-1", name: "LangWatch" }),
  } as unknown as OrganizationService;
}

function testAuthz(): AuthzService {
  return {
    hasPermission: async () => true,
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  } as unknown as AuthzService;
}

/** Only the delegates these scenarios read; everything else refuses by name. */
function testPrisma(rows: readonly unknown[]) {
  const findMany = vi.fn(async () => [...rows]);
  const findFirst = vi.fn(async () => rows[0] ?? null);

  return new Proxy(
    {
      modelProvider: { findMany, findFirst },
      modelDefaultConfig: { findMany: async () => [] },
      modelCost: { findMany: async () => [] },
    },
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        return new Proxy(
          {},
          {
            get: (_inner, method) => () => {
              throw new Error(
                `the test reached prisma.${String(property)}.${String(method)}, which it does not stub`,
              );
            },
          },
        );
      },
      // Presence has to agree with the getter: the model-provider repository
      // asks whether a client HAS its delegates before it uses one.
      has: () => true,
    },
  ) as unknown as PrismaClient;
}

function compose(
  overrides: {
    rows?: readonly unknown[];
    rateLimit?: () => Promise<{ allowed: boolean; remaining: number; resetAt: number }>;
    environment?: Record<string, string | undefined>;
    isSaas?: boolean;
  } = {},
): ModelProviderService {
  return composeApiModelProviders({
    prisma: testPrisma(overrides.rows ?? []),
    projects: testProjects(),
    organizations: testOrganizations(),
    authorization: testAuthz(),
    encryption: testCipher(),
    rateLimit:
      overrides.rateLimit ??
      (async () => ({ allowed: true, remaining: 19, resetAt: Date.now() + 60_000 })),
    environment: overrides.environment ?? {},
    isSaas: overrides.isSaas ?? false,
    egress: { blockLocal: true, allowedHosts: [], verifyTls: true },
    nlpServiceUrl: "http://127.0.0.1:5561",
    processName: "langwatch-api-test",
  });
}

describe("given the model gateway this process composes for itself", () => {
  describe("when a run prepares a provider's execution parameters", () => {
    it("reads the credential back through the deployment's own cipher", async () => {
      const stored = `enc:${JSON.stringify({ OPENAI_API_KEY: "sk-stored" })}`;
      const gateway = compose({ rows: [providerRow(stored)] });

      const parameters = await gateway.prepareExecution({
        projectId: "project-1",
        model: "openai/gpt-5-mini",
      });

      expect(parameters.api_key).toBe("sk-stored");
    });

    it("leaves the key out when the column will not decrypt, rather than sending a ciphertext", async () => {
      const gateway = compose({ rows: [providerRow("written-under-a-different-key")] });

      const parameters = await gateway.prepareExecution({
        projectId: "project-1",
        model: "openai/gpt-5-mini",
      });

      expect(parameters.api_key).toBeUndefined();
    });
  });

  describe("when a connection test is asked for more often than its window allows", () => {
    it("refuses through the process's own counter, with a retry window", async () => {
      const resetAt = Date.now() + 30_000;
      const gateway = compose({
        rows: [providerRow(`enc:${JSON.stringify({ OPENAI_API_KEY: "sk-stored" })}`)],
        rateLimit: async () => ({ allowed: false, remaining: 0, resetAt }),
      });

      await expect(
        gateway.testConnection({
          projectId: "project-1",
          modelProviderId: "model_provider_1",
        }),
      ).rejects.toBeInstanceOf(ModelProviderTestRateLimitedError);
    });
  });

  describe("when the deployment credentials a provider from its own environment", () => {
    it("leaves the system provider disabled on a self-hosted install", async () => {
      const gateway = compose({
        environment: { OPENAI_API_KEY: "sk-deployment" },
        isSaas: false,
      });

      const providers = await gateway.listForProject({ projectId: "project-1" });

      expect(providers.filter((provider) => provider.isSystem)).toEqual([]);
    });

    it("offers it on the hosted deployment, which is the one that holds the key", async () => {
      const gateway = compose({
        environment: { OPENAI_API_KEY: "sk-deployment" },
        isSaas: true,
      });

      const providers = await gateway.listForProject({ projectId: "project-1" });

      expect(providers.map((provider) => provider.provider)).toContain("openai");
    });
  });
});
