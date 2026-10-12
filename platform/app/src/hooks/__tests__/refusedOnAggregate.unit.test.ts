import { ALL_PERMISSIONS } from "@langwatch/authz";
import { describe, expect, it } from "vitest";
import { writesUnderProject } from "~/server/app-layer/projects/project-write-guard";
import {
  isOrgScopedPermission,
  refusedOnAggregate,
} from "../useOrganizationTeamProject";

/**
 * The client side of ADR-144 decision 8. The server refuses a mutation that
 * writes under an aggregate project; it never sees an organisation-level
 * write as one, because such a write names no project. The client gate asks
 * the same question, so it hides project writes on an aggregate page and
 * leaves organisation writes alone.
 */
describe("refusedOnAggregate", () => {
  describe("given a write under the project", () => {
    it.each([
      "datasets:create",
      "prompts:create",
      "annotations:create",
    ] as const)("refuses %s", (permission) => {
      expect(refusedOnAggregate(permission)).toBe(true);
    });
  });

  describe("given an organisation-level write", () => {
    it("refuses none of them", () => {
      const organizationWrites = ALL_PERMISSIONS.filter(
        (permission) =>
          isOrgScopedPermission(permission) && writesUnderProject(permission),
      );

      expect(organizationWrites.length).toBeGreaterThan(0);
      for (const permission of organizationWrites) {
        expect(refusedOnAggregate(permission)).toBe(false);
      }
    });
  });

  describe("given a read or a write that manages the project itself", () => {
    it.each([
      "traces:view",
      "project:update",
      "organization:manage",
    ] as const)("does not refuse %s", (permission) => {
      expect(refusedOnAggregate(permission)).toBe(false);
    });
  });
});
