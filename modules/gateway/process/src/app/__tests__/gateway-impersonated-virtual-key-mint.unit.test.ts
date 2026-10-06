import { PermissionDeniedError } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 * @see modules/gateway/specs/gateway-virtual-key-impersonated-mint.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { GatewayModule } from "../gateway.app.ts";

const ORGANIZATION_ID = "organization_1";
const ACTOR = { type: "user", id: "member-1" };

const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

async function gatewayApp() {
  const hasPermission = vi.fn<AuthzApi["hasPermission"]>(async () => true);
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
  return { app, hasPermission };
}

describe("given an operator acting as a member", () => {
  /** @scenario "Creating a virtual key is refused while an operator acts as another member" */
  it("refuses the create with permission_denied before any permission is asked", async () => {
    const { app, hasPermission } = await gatewayApp();

    const creating = app.authorizeVirtualKeyCreate({
      actor: ACTOR,
      impersonatorId: "operator-1",
      organizationId: ORGANIZATION_ID,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID }],
      traceProjectId: void 0,
      guardrailAttachments: void 0,
    });

    await expect(creating).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(creating).rejects.toMatchObject({ code: "permission_denied" });
    expect(hasPermission).not.toHaveBeenCalled();
  });

  /** @scenario "Rotating a virtual key is refused while an operator acts as another member" */
  it("refuses the rotation with permission_denied before the key is read", async () => {
    const { app, hasPermission } = await gatewayApp();

    const rotating = app.authorizeVirtualKeyOperation({
      actor: ACTOR,
      impersonatorId: "operator-1",
      organizationId: ORGANIZATION_ID,
      id: "vk_1",
      permission: "virtualKeys:rotate",
    });

    await expect(rotating).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(rotating).rejects.toMatchObject({ code: "permission_denied" });
    expect(hasPermission).not.toHaveBeenCalled();
  });
});
