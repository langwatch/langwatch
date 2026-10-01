/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { ResourceScope } from "@langwatch/kernel";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores";
import { ScopedSecrets } from "@langwatch/secrets";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { GatewayApp } from "../gateway.app.ts";

const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

const reversible: Encryption = {
  encrypt: (plaintext) => `sealed:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace(/^sealed:/, ""),
};

function gatewayApp(): Promise<GatewayApp> {
  return GatewayApp.create({
    dependencies: {
      webhooks: createApiFixture({}),
      entitlement: createApiFixture({}),
      authz: createApiFixture({}),
      projects: createApiFixture({}),
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture({}),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: createApiFixture({}),
    },
    members: {
      prisma: createApiFixture<PrismaClient>({}),
      clickhouse: createApiFixture<ClickHouseQueryClient>({}),
      encryption: reversible,
      redis: memoryRedisDouble(),
      publicBaseUrl: "https://app.acme.example",
    },
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      baseUrl: void 0,
      publicUrl: void 0,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
}

describe("the agent cache on an installed gateway", () => {
  describe("given the process supplied its Redis connection and encryption", () => {
    /** @scenario "The installed agent cache is served from the process's own members" */
    it("stores, claims, reads back and removes an entry", async () => {
      const app = await gatewayApp();
      const entry = { projectId: "project-1", name: "ACME_SESSION" };

      await expect(app.putAgentCacheEntry({ ...entry, value: "first" })).resolves.toMatchObject({
        name: "ACME_SESSION",
      });
      await expect(app.claimAgentCacheEntry({ ...entry, value: "second" })).resolves.toMatchObject({
        claimed: false,
      });
      await expect(app.getAgentCacheEntry(entry)).resolves.toEqual({
        name: "ACME_SESSION",
        value: "first",
      });

      await app.deleteAgentCacheEntry(entry);

      await expect(app.getAgentCacheEntry(entry)).rejects.toMatchObject({
        code: "cache_entry_not_found",
      });
    });
  });
});
