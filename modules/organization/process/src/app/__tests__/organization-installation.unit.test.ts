import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RoleApi } from "@langwatch/role-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import type { ShareApi } from "@langwatch/share-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { organizationProcessModule } from "../../organization.module.ts";

/**
 * @vitest-environment node
 * The feature installs: a process booting it over memory gets a working
 * `OrganizationApi` in either role. A peer API operation called while the app
 * is still being constructed is refused before boot returns, so it shows here.
 */
function process(role: "api" | "worker") {
  const secrets = SecretsResolver.over(SecretsChain.start({ environment: {} }));
  return createApp({ role, secrets: (owner, declared) => secrets.scopeTo(owner, declared) })
    .withModules([organizationProcessModule])
    .withStores(memoryStores())
    .withObservability((observability) => observability.withLogging(createTestLogger().logger))
    .withConfig({
      organization: {
        signUp: { mode: "open", allowedDomains: [], adminEmails: [] },
        publicBaseUrl: undefined,
      },
    })
    .provide({
      "api-key": createApiFixture<ApiKeyApi>(),
      authz: createApiFixture<AuthzApi>(),
      entitlement: createApiFixture<EntitlementApi>(),
      identity: createApiFixture<IdentityApi>(),
      notification: createApiFixture<NotificationService>(),
      project: createApiFixture<ProjectApi>(),
      role: createApiFixture<RoleApi>(),
      share: createApiFixture<ShareApi>(),
      user: createApiFixture<UserApi>(),
    });
}

describe("organization app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      expect(runtime.service(OrganizationApi)).toBe(
        runtime.module(organizationProcessModule).provided,
      );
    } finally {
      await runtime.stop();
    }
  });

  it("leaves the dated department-link reads to governance, which owns the table", async () => {
    const runtime = await process("api").boot();

    try {
      const organizations = runtime.service(OrganizationApi);
      expect("findMemberDepartmentsOnDay" in organizations).toBe(false);
      expect("findOpenMemberDepartmentLinks" in organizations).toBe(false);
    } finally {
      await runtime.stop();
    }
  });
});
