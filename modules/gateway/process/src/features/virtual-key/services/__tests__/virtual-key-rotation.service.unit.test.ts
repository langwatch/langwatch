/**
 * @vitest-environment node
 * @see modules/gateway/specs/gateway-virtual-key-rotation.feature
 */
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { memoryVirtualKeySeed } from "../../../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { GatewayModule } from "../../../../app/gateway.app.ts";
import { MemoryGatewayChannels } from "../../../../channels/memory/memory.gateway.channels.ts";
import { MemoryGatewayRepositories } from "../../../../repositories/memory/memory.gateway.repositories.ts";
import { MemoryGatewayStore } from "../../../../repositories/memory/memory.gateway.store.ts";

const ORGANIZATION_ID = "org_1";
const KEY = { id: "vk_demo", organizationId: ORGANIZATION_ID, actorUserId: "jane" };
const PREVIOUS_HASH = "hash_vk_demo";
const secrets = new ScopedSecrets(async (handle, build) =>
  build(handle.id === "LW_VIRTUAL_KEY_PEPPER" ? "test-virtual-key-pepper" : undefined),
);

async function gatewayWithOneKey() {
  const store = MemoryGatewayStore.create({
    teams: [{ id: "team_1", organizationId: ORGANIZATION_ID, name: "Platform", slug: "platform" }],
  });
  const { repositories } = new MemoryGatewayRepositories(store);
  await repositories.virtualKeys.create(
    memoryVirtualKeySeed({ id: KEY.id, name: "demo", organizationId: ORGANIZATION_ID }),
  );
  const app = await GatewayModule.create({
    channels: MemoryGatewayChannels.create(),
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
    repositories,
    config: {
      foldCacheTtlSeconds: 300,
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
    secrets,
  });
  return { app, repositories };
}

describe("rotating a virtual key's secret", () => {
  /** @scenario "A rotated secret keeps the previous one working through its grace window" */
  it("keeps the previous secret resolving by default", async () => {
    const { app, repositories } = await gatewayWithOneKey();

    await app.rotateVirtualKey(KEY);

    expect(await repositories.virtualKeys.findByHashedSecret(PREVIOUS_HASH)).toMatchObject({
      id: KEY.id,
    });
  });

  /** @scenario "A rotation can end the previous secret at once" */
  it("stops the previous secret resolving when asked to end it now", async () => {
    const { app, repositories } = await gatewayWithOneKey();

    await app.rotateVirtualKey({ ...KEY, endPreviousSecret: true });

    expect(await repositories.virtualKeys.findByHashedSecret(PREVIOUS_HASH)).toBeNull();
  });
});
