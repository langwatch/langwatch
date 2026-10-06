import type { AuthzApi } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 * @see specs/ai-gateway/governance/vk-scope-rbac.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { memoryVirtualKeySeed } from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { MemoryGatewayStore } from "../../repositories/memory/memory.gateway.store.ts";
import { GatewayModule } from "../gateway.app.ts";

const ORGANIZATION_ID = "org_1";
const ACTOR = { user: { id: "jane" } } as const;
const secrets = new ScopedSecrets(async (handle, build) =>
  build(handle.id === "LW_VIRTUAL_KEY_PEPPER" ? "test-virtual-key-pepper" : undefined),
);

/** `rotateAt` names the grants the caller holds, as permission@teamId. */
async function gatewayHolding({ rotateAt }: { rotateAt: string[] }) {
  const store = MemoryGatewayStore.create({
    teams: [{ id: "team_1", organizationId: ORGANIZATION_ID, name: "Platform", slug: "platform" }],
  });
  const { repositories } = new MemoryGatewayRepositories(store);
  await repositories.virtualKeys.create(
    memoryVirtualKeySeed({ id: "vk_demo", name: "demo", organizationId: ORGANIZATION_ID }),
  );
  const hasPermission = vi.fn<AuthzApi["hasPermission"]>(async (input) =>
    rotateAt.includes(`${input.permission}@${input.teamId}`),
  );
  const app = await GatewayModule.create({
    dependencies: {
      authz: createApiFixture<AuthzApi>({ hasPermission }),
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
  return { app, hasPermission, repositories };
}

describe("given a virtual key scoped to a team", () => {
  /** @scenario Rotating a VK requires virtualKeys:rotate */
  it("lets the holder of rotate at that team mint a new secret and bump the revision", async () => {
    const { app, hasPermission, repositories } = await gatewayHolding({
      rotateAt: ["virtualKeys:rotate@team_1"],
    });
    const before = await repositories.virtualKeys.findById({
      id: "vk_demo",
      organizationId: ORGANIZATION_ID,
    });

    await app.authorizeVirtualKeyOperation({
      actor: ACTOR,
      organizationId: ORGANIZATION_ID,
      id: "vk_demo",
      permission: "virtualKeys:rotate",
    });
    const { virtualKey, secret } = await app.rotateVirtualKey({
      id: "vk_demo",
      organizationId: ORGANIZATION_ID,
      actorUserId: ACTOR.user.id,
    });

    expect(hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "jane",
        permission: "virtualKeys:rotate",
        teamId: "team_1",
      }),
    );
    expect(secret).toMatch(/^vk-lw-/);
    expect(virtualKey.hashedSecret).not.toBe(before!.hashedSecret);
    expect(virtualKey.revision).toBe(before!.revision + 1n);
  });

  it("refuses a holder of another permission at that team, minting nothing", async () => {
    const { app, repositories } = await gatewayHolding({ rotateAt: ["virtualKeys:view@team_1"] });

    await expect(
      app.authorizeVirtualKeyOperation({
        actor: ACTOR,
        organizationId: ORGANIZATION_ID,
        id: "vk_demo",
        permission: "virtualKeys:rotate",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(
      (await repositories.virtualKeys.findById({ id: "vk_demo", organizationId: ORGANIZATION_ID }))
        ?.revision,
    ).toBe(1n);
  });
});
