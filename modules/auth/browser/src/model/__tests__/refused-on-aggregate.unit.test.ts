import { ALL_PERMISSIONS, permissionGrantTiers } from "@langwatch/authorization";
import { writesUnderProject } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { refusedOnAggregate } from "../refused-on-aggregate.ts";

/**
 * The client side of ADR-175 decision 8: project writes are hidden on an
 * aggregate page, organisation writes (which name no project) are not.
 */
describe("refusedOnAggregate()", () => {
  describe("given a write under the project", () => {
    it.each(["datasets:create", "prompts:create", "annotations:create"] as const)(
      "refuses %s",
      (permission) => {
        expect(refusedOnAggregate(permission)).toBe(true);
      },
    );
  });

  describe("given an organisation-level write", () => {
    it("refuses none of them", () => {
      const organizationWrites = ALL_PERMISSIONS.filter((permission) => {
        const tiers = permissionGrantTiers(permission);
        const organizationOnly = tiers.length === 1 && tiers[0] === "organization";
        return organizationOnly && writesUnderProject(permission);
      });

      expect(organizationWrites.length).toBeGreaterThan(0);
      for (const permission of organizationWrites) {
        expect(refusedOnAggregate(permission)).toBe(false);
      }
    });
  });

  describe("given a read or a write that manages the project itself", () => {
    it.each(["traces:view", "project:update", "organization:manage"] as const)(
      "does not refuse %s",
      (permission) => {
        expect(refusedOnAggregate(permission)).toBe(false);
      },
    );
  });

  describe("given a permission the registry does not know", () => {
    it("does not refuse it, leaving the grant check to answer", () => {
      expect(refusedOnAggregate("nothing:real")).toBe(false);
    });
  });
});
