import type { AuthzApi } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 * @see specs/ai-gateway/governance/vk-scope-rbac.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { memoryVirtualKeySeed } from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { MemoryGatewayAuditRepository } from "../../repositories/memory/memory.gateway-audit.repository.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { MemoryGatewayStore } from "../../repositories/memory/memory.gateway.store.ts";
import { GatewayModule } from "../gateway.app.ts";

const ORGANIZATION_ID = "org_1";
const ACTOR = { user: { id: "ian" } } as const;
const secrets = new ScopedSecrets(async (handle, build) =>
  build(handle.id === "LW_VIRTUAL_KEY_PEPPER" ? "test-virtual-key-pepper" : undefined),
);

/** `updateAt` names the project the caller holds `virtualKeys:update` at. */
async function gatewayHolding({ updateAt }: { updateAt: string[] }) {
  const store = MemoryGatewayStore.create({
    teams: [{ id: "team_1", organizationId: ORGANIZATION_ID, name: "Platform", slug: "platform" }],
  });
  const audit = MemoryGatewayAuditRepository.create();
  const repositories = { ...new MemoryGatewayRepositories(store).repositories, audit };
  await repositories.virtualKeys.create({
    ...memoryVirtualKeySeed({ id: "vk_demo", name: "demo", organizationId: ORGANIZATION_ID }),
    scopes: [{ scopeType: "PROJECT", scopeId: "demo" }],
    traceProjectId: "demo",
  });
  const hasPermission = vi.fn<AuthzApi["hasPermission"]>(
    async (input) =>
      input.permission === "virtualKeys:update" &&
      input.projectId !== undefined &&
      updateAt.includes(input.projectId),
  );
  const app = await GatewayModule.create({
    dependencies: {
      authz: createApiFixture<AuthzApi>({ hasPermission }),
      projects: createApiFixture<ProjectApi>({
        findIdentity: async (id) => ({
          id,
          name: id,
          slug: id,
          teamId: "team_1",
          organizationId: ORGANIZATION_ID,
          isPersonal: false,
          ownerUserId: null,
        }),
        listTraceDestinations: async (projectIds) =>
          projectIds.map((id) => ({ id, teamId: "team_1", archivedAt: null })),
      }),
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
  return { app, audit, hasPermission, repositories };
}

describe("given a virtual key scoped to a project", () => {
  /** @scenario Updating a VK requires virtualKeys:update at every one of the VK's scopes */
  it("lets the holder of update at that project rename it and audits who changed it", async () => {
    const { app, audit, hasPermission } = await gatewayHolding({ updateAt: ["demo"] });

    await app.authorizeVirtualKeyUpdate({
      actor: ACTOR,
      organizationId: ORGANIZATION_ID,
      id: "vk_demo",
    });
    const updated = await app.updateVirtualKey({
      id: "vk_demo",
      organizationId: ORGANIZATION_ID,
      actorUserId: ACTOR.user.id,
      name: "renamed",
    });

    expect(hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "ian",
        permission: "virtualKeys:update",
        projectId: "demo",
      }),
    );
    expect(updated.name).toBe("renamed");
    expect(audit.entries()).toEqual([
      expect.objectContaining({
        actorUserId: "ian",
        action: "gateway.virtual_key.updated",
        targetKind: "virtual_key",
        targetId: "vk_demo",
      }),
    ]);
  });

  it("refuses a holder of update at another project, changing and auditing nothing", async () => {
    const { app, audit, repositories } = await gatewayHolding({ updateAt: ["elsewhere"] });

    await expect(
      app.authorizeVirtualKeyUpdate({
        actor: ACTOR,
        organizationId: ORGANIZATION_ID,
        id: "vk_demo",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(
      (await repositories.virtualKeys.findById({ id: "vk_demo", organizationId: ORGANIZATION_ID }))
        ?.name,
    ).toBe("demo");
    expect(audit.entries()).toEqual([]);
  });
});
