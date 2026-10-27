// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * At-least-once delivery: SCIM's cost-center fact handled twice leaves one department and one
 * assignment. Spec: specs/ai-gateway/governance/departments.feature
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

describe("assignScimCostCenterDepartment redelivery", () => {
  describe("when the same fact is delivered twice", () => {
    /** @scenario "A redelivered cost-center fact lands the member in one department" */
    it("lands the member in one department, created once", async () => {
      const world = departmentsByName();
      const handle = assignScimCostCenterDepartment({ departments: world.departments });
      const fact = { organizationId: ORG, userId: "user-1", costCenter: "Engineering" };

      await handle(fact);
      await handle(fact);

      expect(world.byName.size).toBe(1);
      expect(world.assigned.get("user-1")).toBe(world.byName.get("Engineering"));
    });
  });
});
