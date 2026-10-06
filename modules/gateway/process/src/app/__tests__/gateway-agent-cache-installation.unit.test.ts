import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { GatewayModule } from "../gateway.app.ts";

const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

function gatewayApp(): Promise<GatewayModule> {
  return GatewayModule.create({
    dependencies: {
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
      apiKeys: createApiFixture({}),
    },
    repositories: MemoryGatewayRepositories.create(),
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      publicBaseUrl: "https://app.acme.example",
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
  describe("given the gateway installed over its own repositories", () => {
    /** @scenario "The installed agent cache is served from the gateway's own repositories" */
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
