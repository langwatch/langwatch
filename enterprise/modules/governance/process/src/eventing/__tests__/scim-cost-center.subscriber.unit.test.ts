// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SCIM's cost-center fact, landed as a department from governance's side.
 * Spec: specs/ai-gateway/governance/departments.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  assignScimCostCenterDepartment,
  type ScimCostCenterDepartments,
} from "../scim-cost-center.subscriber.ts";

const ORG = "org-1";

function departmentsByName() {
  const byName = new Map<string, string>();
  const assigned = new Map<string, string | null>();
  const departments = {
    departmentResolveByNameOrCreate: vi.fn(
      async ({ organizationId, name }: { organizationId: string; name: string }) => {
        const id = byName.get(name) ?? `department-${byName.size + 1}`;
        byName.set(name, id);
        const at = new Date(0);
        return { id, organizationId, name, createdAt: at, updatedAt: at };
      },
    ),
    departmentAssignUser: vi.fn(
      async ({ userId, departmentId }: { userId: string; departmentId: string | null }) => {
        assigned.set(userId, departmentId);
      },
    ),
  } satisfies ScimCostCenterDepartments;
  return { departments, byName, assigned };
}

describe("assignScimCostCenterDepartment", () => {
  describe("given a member whose cost center SCIM recorded", () => {
    it("assigns the member to the department the cost center names", async () => {
      const world = departmentsByName();
      world.byName.set("Engineering", "department-engineering");
      const handle = assignScimCostCenterDepartment({ departments: world.departments });

      await handle({ organizationId: ORG, userId: "user-1", costCenter: "Engineering" });

      expect(world.assigned.get("user-1")).toBe("department-engineering");
    });

    it("creates the department the first time a cost center names it, then assigns it", async () => {
      const world = departmentsByName();
      const handle = assignScimCostCenterDepartment({ departments: world.departments });

      await handle({ organizationId: ORG, userId: "user-1", costCenter: "Research" });

      expect(world.byName.has("Research")).toBe(true);
      expect(world.assigned.get("user-1")).toBe(world.byName.get("Research"));
    });

    it("replaces the prior assignment when a later fact names another cost center", async () => {
      const world = departmentsByName();
      const handle = assignScimCostCenterDepartment({ departments: world.departments });

      await handle({ organizationId: ORG, userId: "user-1", costCenter: "Engineering" });
      await handle({ organizationId: ORG, userId: "user-1", costCenter: "Marketing" });

      expect(world.assigned.get("user-1")).toBe(world.byName.get("Marketing"));
    });
  });

  describe("when the fact clears the cost center", () => {
    /** @scenario "A cleared cost-center fact unassigns without resolving a department" */
    it("clears the member's department without resolving one", async () => {
      const world = departmentsByName();
      const handle = assignScimCostCenterDepartment({ departments: world.departments });

      await handle({ organizationId: ORG, userId: "user-1", costCenter: null });

      expect(world.departments.departmentResolveByNameOrCreate).not.toHaveBeenCalled();
      expect(world.assigned.get("user-1")).toBeNull();
    });
  });
});
