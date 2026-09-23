/**
 * @vitest-environment node
 * The memory role repository reads back what it writes through the same instances, proving the
 * in-memory backend is not a stub.
 */
import { ROLE_KIND } from "@langwatch/role-contract";
import { describe, expect, it } from "vitest";

import { MemoryRoleRepository } from "../memory.role.repository.ts";

const ORGANIZATION_ID = "org-1";
const ROLE_ID = "role-1";

describe("given the memory-backed role repositories", () => {
  describe("when saving a role", () => {
    it("reads back the role it just saved", async () => {
      const roles = MemoryRoleRepository.create();

      const now = new Date();
      const role = {
        id: ROLE_ID,
        organizationId: ORGANIZATION_ID,
        name: "Custom Editor",
        description: "Can edit content",
        permissions: ["content:edit", "content:read"],
        kind: ROLE_KIND.CUSTOM,
        createdAt: now,
        updatedAt: now,
      };

      roles.save(role);

      const found = await roles.findById({ roleId: ROLE_ID });

      expect(found).toMatchObject({
        id: ROLE_ID,
        organizationId: ORGANIZATION_ID,
        name: "Custom Editor",
        kind: ROLE_KIND.CUSTOM,
      });
    });

    it("finds a role by name within an organization", async () => {
      const roles = MemoryRoleRepository.create();

      const now = new Date();
      roles.save({
        id: ROLE_ID,
        organizationId: ORGANIZATION_ID,
        name: "Unique Role",
        description: null,
        permissions: [],
        kind: ROLE_KIND.CUSTOM,
        createdAt: now,
        updatedAt: now,
      });

      const found = await roles.findByName({
        organizationId: ORGANIZATION_ID,
        name: "Unique Role",
      });

      expect(found?.id).toBe(ROLE_ID);
    });

    it("finds custom roles assigned to an organization", async () => {
      const roles = MemoryRoleRepository.create();

      const now = new Date();
      const customRoleId = "custom-1";
      roles.save({
        id: customRoleId,
        organizationId: ORGANIZATION_ID,
        name: "Custom Role",
        description: null,
        permissions: [],
        kind: ROLE_KIND.CUSTOM,
        createdAt: now,
        updatedAt: now,
      });

      const assignable = await roles.findAssignable({
        roleIds: [customRoleId, "builtin-admin"],
        organizationId: ORGANIZATION_ID,
      });

      expect(assignable).toHaveLength(1);
      expect(assignable[0]?.id).toBe(customRoleId);
    });

    it("counts assigned users for a role", async () => {
      const roles = MemoryRoleRepository.create();

      roles.assign({ userId: "user-1", teamId: "team-1", customRoleId: ROLE_ID });
      roles.assign({ userId: "user-2", teamId: "team-1", customRoleId: ROLE_ID });

      const count = await roles.countAssignedUsers({ roleId: ROLE_ID });

      expect(count).toBe(2);
    });
  });
});
