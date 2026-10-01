/**
 * The words the roles surface puts on a permission, and the arithmetic under the picker.
 * Spec: specs/identity/org-access-cluster.feature
 */

import { AUTHZ_RESOURCES } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import {
  levelOf,
  offeredActions,
  offeredAreas,
  permissionSentence,
  permissionsNeedingOrganizationScope,
  permissionTakesEffectAt,
  resourceCopy,
  setLevel,
  withDependencies,
  withoutDependents,
} from "../role-permissions.ts";

describe("given the words on a permission", () => {
  describe("when the registry gains or loses a resource", () => {
    /** @scenario Every permission the picker offers is explained in words */
    it("has a name and a sentence for every resource the engine knows", () => {
      for (const resource of Object.keys(AUTHZ_RESOURCES)) {
        const copy = resourceCopy(resource);
        expect(copy.label).not.toBe("Other");
        expect(copy.blurb.length).toBeGreaterThan(0);
      }
    });
  });

  describe("when a token is turned into a sentence", () => {
    /** @scenario Every permission the picker offers is explained in words */
    it("reads as something a person does", () => {
      expect(permissionSentence("traces:view")).toBe("View traces");
      expect(permissionSentence("datasets:manage")).toBe("Full access to datasets");
    });
  });
});

describe("given the access level of one resource", () => {
  describe("when nothing is picked", () => {
    /** @scenario A role is built one part of the product at a time */
    it("reads as none", () => {
      expect(levelOf({ resource: "datasets", selected: [] })).toBe("none");
    });
  });

  describe("when the level is set to read", () => {
    /** @scenario A role is built one part of the product at a time */
    it("grants only the view of that resource", () => {
      const next = setLevel({
        resource: "datasets",
        level: "read",
        selected: [],
      });

      expect(next).toEqual(["datasets:view"]);
      expect(levelOf({ resource: "datasets", selected: next })).toBe("read");
    });
  });

  describe("when the level is set to full access", () => {
    /** @scenario A role is built one part of the product at a time */
    it("grants the one permission that covers the rest", () => {
      const next = setLevel({
        resource: "datasets",
        level: "full",
        selected: [],
      });

      expect(next).toEqual(["datasets:manage"]);
      expect(levelOf({ resource: "datasets", selected: next })).toBe("full");
    });

    /** @scenario A role is built one part of the product at a time */
    it("grants every offered action where the resource has no full-access permission", () => {
      const next = setLevel({
        resource: "traces",
        level: "full",
        selected: [],
      });

      expect(next.toSorted()).toEqual(["traces:share", "traces:view"]);
    });
  });

  describe("when the level changes on one resource", () => {
    /** @scenario A role is built one part of the product at a time */
    it("leaves every other resource alone", () => {
      const next = setLevel({
        resource: "datasets",
        level: "none",
        selected: ["datasets:manage", "traces:view"],
      });

      expect(next).toEqual(["traces:view"]);
    });
  });

  describe("when individual actions are picked", () => {
    /** @scenario Picking an action that needs another brings it along */
    it("brings the view along with a change", () => {
      const next = withDependencies({
        resource: "datasets",
        permission: "datasets:update",
        selected: [],
      });

      expect(next.toSorted()).toEqual(["datasets:update", "datasets:view"]);
      expect(levelOf({ resource: "datasets", selected: next })).toBe("custom");
    });

    /** @scenario Picking an action that needs another brings it along */
    it("takes the changes away with the view", () => {
      const next = withoutDependents({
        resource: "datasets",
        permission: "datasets:view",
        selected: ["datasets:view", "datasets:update", "traces:view"],
      });

      expect(next).toEqual(["traces:view"]);
    });
  });

  describe("when a resource can only be read", () => {
    /** @scenario A role is built one part of the product at a time */
    it("offers reading and nothing else", () => {
      expect(offeredActions("cost")).toEqual(["view"]);
      expect(offeredActions("auditLog")).toEqual(["view"]);
    });
  });
});

describe("given a permission that only the organization can grant", () => {
  describe("when the role is previewed on a team", () => {
    /** @scenario The preview says which permissions do nothing at that scope */
    it("says the permission does nothing there", () => {
      expect(
        permissionTakesEffectAt({
          permission: "governance:manage",
          scopeType: "TEAM",
        }),
      ).toBe(false);
      expect(
        permissionTakesEffectAt({
          permission: "governance:manage",
          scopeType: "ORGANIZATION",
        }),
      ).toBe(true);
    });

    /** @scenario The preview says which permissions do nothing at that scope */
    it("leaves the permissions a team really can grant alone", () => {
      expect(
        permissionsNeedingOrganizationScope([
          "traces:view",
          "governance:manage",
          "datasets:manage",
        ]),
      ).toEqual(["governance:manage"]);
    });
  });
});

describe("given the picker's areas", () => {
  describe("when it is drawn", () => {
    /** @scenario Every permission the picker offers is explained in words */
    it("puts every offered resource in exactly one area", () => {
      const areas = offeredAreas();
      const seen = areas.flatMap((group) => group.resources);

      expect(seen.length).toBe(new Set(seen).size);
      expect(areas.length).toBeGreaterThan(0);
      for (const group of areas) {
        expect(group.resources.length).toBeGreaterThan(0);
      }
    });
  });
});
