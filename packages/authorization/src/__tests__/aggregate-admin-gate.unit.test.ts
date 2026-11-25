import { describe, expect, it } from "vitest";

import { refusedOnAggregate, writesUnderProject } from "../aggregate-admin-gate.ts";
import { ALL_PERMISSIONS } from "../registry.ts";
import { isOrgScopedPermission } from "../scope-tiers.ts";

/**
 * The client side of ADR-177 decision 8: the server refuses a write under an
 * aggregate; an organisation-level write names no project, so neither refuses it.
 */
describe("refusedOnAggregate", () => {
  describe("given an aggregate project", () => {
    describe("when the permission writes under the project", () => {
      it.each(["datasets:create", "prompts:create", "annotations:create"] as const)(
        "refuses %s",
        (permission) => {
          expect(refusedOnAggregate({ kind: "aggregate", permission })).toBe(true);
        },
      );
    });

    describe("when the permission is an organisation-level write", () => {
      it("refuses none of them", () => {
        const organizationWrites = ALL_PERMISSIONS.filter(
          (permission) => isOrgScopedPermission(permission) && writesUnderProject(permission),
        );

        expect(organizationWrites.length).toBeGreaterThan(0);
        for (const permission of organizationWrites) {
          expect(refusedOnAggregate({ kind: "aggregate", permission })).toBe(false);
        }
      });
    });

    describe("when the permission reads or manages the project itself", () => {
      it.each(["traces:view", "project:update", "organization:manage"] as const)(
        "does not refuse %s",
        (permission) => {
          expect(refusedOnAggregate({ kind: "aggregate", permission })).toBe(false);
        },
      );
    });
  });

  describe("given a project of any other kind, or one not yet read", () => {
    it.each(["application", null, undefined])("refuses no write on %s", (kind) => {
      expect(refusedOnAggregate({ kind, permission: "datasets:create" })).toBe(false);
    });
  });
});
