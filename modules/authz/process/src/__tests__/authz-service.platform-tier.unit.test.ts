/**
 * @see specs/rbac/platform-operators.feature
 */
import { describe, expect, it, vi } from "vitest";

import { StubAuthzListingRepository } from "../repositories/__tests__/support/authz-listing.stub.ts";
import { StubAuthzManagedGrantRepository } from "../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { makeReader } from "../repositories/__tests__/support/authz-read.stub.ts";
import { AuthzService } from "../services/authz.service.ts";

const ORG = "org_1";
const USER = "user_1";

/** An organization ADMIN who also holds a custom role listing every ops permission. */
function orgAdminWithOpsCustomRole() {
  return makeReader({
    findOrganizationMembership: vi.fn().mockResolvedValue({ role: "ADMIN", disabled: false }),
    findUserBindings: vi.fn().mockResolvedValue([
      { roleKey: "admin", scopeType: "ORGANIZATION", scopeId: ORG },
      { roleKey: "custom:ops_role", scopeType: "ORGANIZATION", scopeId: ORG },
    ]),
    findCustomRolePermissions: vi
      .fn()
      .mockResolvedValue([{ id: "ops_role", permissions: ["ops:view", "ops:manage"] }]),
  });
}

function makeService({
  platformCan,
}: {
  platformCan?: (args: { principal: unknown; permission: string }) => Promise<boolean>;
} = {}) {
  return AuthzService.create({
    isOnEngine: async () => true,
    repository: orgAdminWithOpsCustomRole(),
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzManagedGrantRepository(),
    ...(platformCan ? { platformOperators: { can: platformCan } } : {}),
  });
}

describe("AuthzService at the platform tier", () => {
  describe("given an organization admin whose custom role lists ops permissions", () => {
    /** @scenario A custom role carrying ops permissions confers nothing */
    it("holds no ops permission at the organization", async () => {
      const service = makeService();

      await expect(
        service.can({
          principal: { type: "user", id: USER },
          permission: "ops:view",
          scope: { type: "organization", id: ORG },
        }),
      ).resolves.toBe(false);
    });

    /** @scenario A custom role carrying ops permissions confers nothing */
    it("holds no ops permission at the platform", async () => {
      const platformCan = vi.fn().mockResolvedValue(false);
      const service = makeService({ platformCan });

      await expect(
        service.can({
          principal: { type: "user", id: USER },
          permission: "ops:manage",
          scope: { type: "platform" },
        }),
      ).resolves.toBe(false);
      expect(platformCan).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: { type: "user", id: USER },
          permission: "ops:manage",
        }),
      );
    });

    /** @scenario A custom role carrying ops permissions confers nothing */
    it("leaves ops out of the organization's effective permissions", async () => {
      const permissions = await makeService().effectivePermissions({
        principal: { type: "user", id: USER },
        scope: { type: "organization", id: ORG },
      });

      expect(permissions).not.toContain("ops:view");
      expect(permissions).not.toContain("ops:manage");
      expect(permissions).toContain("organization:manage");
    });
  });

  describe("given a composition with no platform tier", () => {
    /** @scenario A user without the platform grant holds nothing at the platform */
    it("refuses every platform question", async () => {
      await expect(
        makeService().can({
          principal: { type: "user", id: USER },
          permission: "ops:view",
          scope: { type: "platform" },
        }),
      ).resolves.toBe(false);
    });
  });

  describe("given a platform tier that grants the user", () => {
    /** @scenario A platform operator holds ops permissions at the platform */
    it("answers from the platform tier alone", async () => {
      const service = makeService({ platformCan: vi.fn().mockResolvedValue(true) });

      await expect(
        service.can({
          principal: { type: "user", id: USER },
          permission: "ops:view",
          scope: { type: "platform" },
        }),
      ).resolves.toBe(true);
    });
  });
});
