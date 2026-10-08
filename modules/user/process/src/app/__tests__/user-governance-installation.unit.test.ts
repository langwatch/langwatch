import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
/**
 * @vitest-environment node
 * CLI token revocation, through the installed app (`/api/me/usage` is governance's now).
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { userProcessModule } from "../../user.module.ts";
import { createUserTestAuth, createUserTestOrganizations } from "./user.fixture.ts";

function process(
  role: "api" | "worker",
  peers: Readonly<{ auth?: AuthApi; project?: ProjectApi }>,
) {
  return createApp({ role })
    .withModules([userProcessModule])
    .withStores(memoryStores())
    .withConfig({ user: { publicBaseUrl: undefined } })
    .withEventing(
      new EventSourcing({ enabled: false, processStore: InMemoryProcessStore.createForTesting() }),
    )
    .provide({
      auth: peers.auth ?? createUserTestAuth(),
      authz: createApiFixture<AuthzApi>({ listPlatformOperators: async () => [] }),
      "enterprise-gateway": createApiFixture<EnterpriseGatewayApi>(),
      gateway: createApiFixture<GatewayApi>(),
      notification: createApiFixture<NotificationService>(),
      organization: createUserTestOrganizations(),
      project: peers.project ?? createApiFixture<ProjectApi>(),
      "stored-object": createApiFixture<StoredObjectApi>(),
    });
}

describe("user app over governance's seams", () => {
  describe("when a person deactivates their own account", () => {
    /** @scenario "userService.deactivate also revokes CLI tokens" */
    it.each(["api", "worker"] as const)(
      "revokes their CLI tokens through auth in the %s role",
      async (role) => {
        const auth = Object.assign(createUserTestAuth(), {
          revokeCliTokens: vi.fn(async () => ({ revokedCount: 2 })),
        });
        const runtime = await process(role, { auth }).boot();

        try {
          const app = runtime.service(UserApi);
          const created = await app.createCredentialUser({
            name: "Ada",
            email: "ada@example.com",
            passwordHash: "hashed:first",
          });

          await app.deactivateAccount({
            userId: created.id,
            caller: { id: created.id, operatorId: created.id, impersonated: false },
          });

          expect(auth.revokeCliTokens).toHaveBeenCalledWith({ userId: created.id });
        } finally {
          await runtime.stop();
        }
      },
    );
  });
});
