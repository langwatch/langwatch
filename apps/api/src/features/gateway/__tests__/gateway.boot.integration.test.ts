/**
 * @vitest-environment node
 * Boots the gateway at `role: "api"` over focused persistence doubles.
 * Full control-plane doors share one app; REST-only installs keep their own gates.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { AuthzService } from "@langwatch/authz-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { GatewaySpendConfirmation } from "@langwatch/gateway-server";
import { describe, expect, it, vi } from "vitest";

import {
  composeGatewayAgentCache,
  composeGatewayElevenLabsWebhook,
  installApiGateway,
} from "../gateway.composition.ts";
import type { ApiTrpcInfrastructure } from "../../../platform/infrastructure/api-trpc.infrastructure.ts";

const ORGANIZATION_ID = "organization_boot";
const cacheEncryption = {
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ""),
};

/** The two tables this boot reads, and nothing else. */
function memoryDatabase() {
  return {
    gatewayCacheRule: { findMany: vi.fn(async () => []) },
    gatewayGuardrail: { findMany: vi.fn(async () => []) },
    organization: {
      findUnique: vi.fn(async () => ({ id: ORGANIZATION_ID })),
    },
  } as unknown as PrismaClient;
}

function installOver(database: PrismaClient) {
  return installApiGateway({
    infrastructure: {
      prisma: database,
      authz: {} as AuthzService,
    } satisfies Pick<ApiTrpcInfrastructure, "prisma" | "authz">,
    peers: {
      projects: {} as ProjectApi,
      evaluators: createApiFixture<EvaluatorApi>(),
      monitors: createApiFixture<MonitorApi>(),
    },
    // No ClickHouse: the spend source is off by name rather than answering a
    // zero nobody can tell from a key that genuinely spent nothing.
    clickhouse: null,
    virtualKeyPepper: "0".repeat(64),
  });
}

describe("installing the gateway on the API process", () => {
  describe("when the process opened its database and named its peers", () => {
    it("boots the module and answers from its application", async () => {
      const database = memoryDatabase();

      const gateway = await installOver(database);

      await expect(gateway.app.listCacheRules(ORGANIZATION_ID)).resolves.toEqual([]);
      expect(gateway.composition).toBeDefined();
    });

    it("refuses an organization the deployment does not hold", async () => {
      const database = memoryDatabase();
      // @ts-expect-error the double narrows to PrismaClient for the installer
      database.organization.findUnique = vi.fn(async () => null);

      const gateway = await installOver(database);

      await expect(gateway.app.assertOrganizationExists(ORGANIZATION_ID)).rejects.toThrow();
    });
  });

  describe("when the process opened none of it", () => {
    it("still answers every gateway operation, by refusing each one by name", async () => {
      const gateway = await installApiGateway({
        infrastructure: undefined,
        peers: undefined,
        clickhouse: null,
        virtualKeyPepper: undefined,
      });

      expect(gateway.composition).toBeUndefined();
      expect(() => gateway.app.listCacheRules(ORGANIZATION_ID)).toThrow(/This deployment has no/);
    });

    it("keeps agent cache available without the unrelated gateway peers", async () => {
      const agentCache = composeGatewayAgentCache({
        encryption: cacheEncryption,
        redis: void 0,
      });
      const gateway = await installApiGateway({
        infrastructure: void 0,
        peers: void 0,
        clickhouse: null,
        virtualKeyPepper: void 0,
        agentCache,
      });
      const cache = gateway.restServices.agentCache;
      if (!cache) throw new Error("the agent-cache family was not installed");

      await cache().putAgentCacheEntry({
        projectId: "project_cache",
        name: "SESSION",
        value: "value",
      });

      await expect(
        cache().getAgentCacheEntry({ projectId: "project_cache", name: "SESSION" }),
      ).resolves.toEqual({ name: "SESSION", value: "value" });
      expect(gateway.restServices.elevenLabsWebhook).toBeUndefined();
      expect(gateway.composition).toBeUndefined();
      expect(() => gateway.app.listCacheRules(ORGANIZATION_ID)).toThrow(/This deployment has no/);
    });

    it("keeps ElevenLabs available without the unrelated gateway peers", async () => {
      const elevenLabsWebhook = composeGatewayElevenLabsWebhook({
        prisma: memoryDatabase(),
        encryption: cacheEncryption,
        spendConfirmation: createApiFixture<GatewaySpendConfirmation>(),
      });
      const gateway = await installApiGateway({
        infrastructure: void 0,
        peers: void 0,
        clickhouse: null,
        virtualKeyPepper: void 0,
        elevenLabsWebhook,
      });

      expect(gateway.restServices.elevenLabsWebhook).toBeTypeOf("function");
      expect(gateway.restServices.agentCache).toBeUndefined();
      expect(gateway.composition).toBeUndefined();
      expect(() => gateway.app.listCacheRules(ORGANIZATION_ID)).toThrow(/This deployment has no/);
    });

    it("keeps agent cache unavailable without encryption", () => {
      expect(composeGatewayAgentCache({ encryption: void 0, redis: void 0 })).toBeUndefined();
    });

    it("keeps ElevenLabs unavailable until all existing collaborators are present", () => {
      const prisma = memoryDatabase();
      const confirmation = createApiFixture<GatewaySpendConfirmation>();

      expect(
        composeGatewayElevenLabsWebhook({
          prisma,
          encryption: void 0,
          spendConfirmation: confirmation,
        }),
      ).toBeUndefined();
      expect(
        composeGatewayElevenLabsWebhook({
          prisma,
          encryption: cacheEncryption,
          spendConfirmation: void 0,
        }),
      ).toBeUndefined();
      expect(
        composeGatewayElevenLabsWebhook({
          prisma: void 0,
          encryption: cacheEncryption,
          spendConfirmation: confirmation,
        }),
      ).toBeUndefined();
    });
  });
});
