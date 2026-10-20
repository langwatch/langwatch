import { AuthzApi } from "@langwatch/authz-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { RoleApi } from "@langwatch/role-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { roleProcessModule } from "../../role.module.ts";
import { testPlan } from "./role.fixture.ts";

const ORGANIZATION_ID = "org-1";

function process(role: "api" | "worker") {
  const authz = createApiFixture<AuthzApi>({
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
  });
  const entitlement = createApiFixture<EntitlementApi>({
    getActivePlan: async () => testPlan(),
  });

  return bootInstalledProcess({
    role,
    modules: [roleProcessModule],
    config: {},
    stores: memoryStores(),
    peers: [
      testPeer({ token: AuthzApi, instance: authz }),
      testPeer({ token: EntitlementApi, instance: entitlement }),
    ],
  });
}

describe("role app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role);

    try {
      const app = runtime.service(RoleApi);

      expect(runtime.module(roleProcessModule).provided).toBe(app);
      await expect(
        app.listRoles({ organizationId: ORGANIZATION_ID, builtIn: false }),
      ).resolves.toMatchObject([{ id: "role-1", name: "Auditor", kind: "custom" }]);
    } finally {
      await runtime.stop();
    }
  });

  it("publishes the permission catalog every custom role is written from", async () => {
    const runtime = await process("api");

    try {
      const catalog = await runtime.service(RoleApi).getPermissionCatalog();

      expect(catalog.actions).toContain("view");
      expect(catalog.resources.some((entry) => entry.organizationExclusive)).toBe(true);
    } finally {
      await runtime.stop();
    }
  });
});
