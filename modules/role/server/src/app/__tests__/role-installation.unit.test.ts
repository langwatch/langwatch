import { AuthzApi } from "@langwatch/authz-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { RoleApi } from "@langwatch/role-contract";
import { createApp } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";
import { roleServer } from "../../role.server.ts";
import {
  AllowingTestRolePlan,
  AllowingTestRoleScope,
  CountingTestRoleBindingIds,
} from "./role.fixture.ts";

const ORGANIZATION_ID = "org-1";

function process() {
  return createApp({ name: "role-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(
      AuthzApi,
      createApiFixture<AuthzApi>({
        listUserCreatedRoles: async () => [
          {
            id: "role-1",
            organizationId: ORGANIZATION_ID,
            name: "Auditor",
            description: null,
            permissions: ["traces:view"],
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        ],
      }),
    )
    .withProvided(OrganizationApi, createApiFixture<OrganizationApi>())
    .withProvided(UserApi, createApiFixture<UserApi>())
    .withModule(roleServer, {
      infrastructure: {
        scope: new AllowingTestRoleScope(),
        plan: new AllowingTestRolePlan(),
        bindingIds: new CountingTestRoleBindingIds(),
      },
    });
}

describe("role app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process().boot({ role });

    try {
      const app = runtime.service(RoleApi);

      expect(runtime.module(roleServer).provided).toBe(app);
      await expect(app.listRoles({ organizationId: ORGANIZATION_ID })).resolves.toMatchObject([
        { id: "role-1", name: "Auditor", kind: "custom" },
      ]);
    } finally {
      await runtime.stop();
    }
  });

  it("publishes the permission catalog every custom role is written from", async () => {
    const runtime = await process().boot({ role: "api" });

    try {
      const catalog = await runtime.service(RoleApi).getPermissionCatalog();

      expect(catalog.actions).toContain("view");
      expect(catalog.resources.some((entry) => entry.organizationExclusive)).toBe(true);
    } finally {
      await runtime.stop();
    }
  });
});
