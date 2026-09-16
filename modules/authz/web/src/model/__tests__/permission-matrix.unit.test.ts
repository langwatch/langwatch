/**
 * Five rules that decide permission matrix clicks. Critical for role
 * delegation; differential harness verified against platform/app closure.
 */

import type { AuthzPermission } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import { permissionsForResource } from "../permission-catalogue.ts";
import {
  isPermissionImplied,
  isPermissionSelected,
  permissionsAddedBy,
  permissionsRemovedBy,
  togglePermission,
} from "../permission-matrix.ts";

const sorted = (permissions: readonly AuthzPermission[]) => [...permissions].sort();

describe("the permission matrix", () => {
  describe("given a resource that offers the full action set", () => {
    /** @scenario Ticking manage grants every action on its resource */
    it("expands manage to every action the editor offers", () => {
      const next = togglePermission({ selected: [], permission: "project:manage" });

      expect(sorted(next)).toEqual(sorted(permissionsForResource("project")));
    });

    /** @scenario Ticking a write action grants view with it */
    it.each(["project:create", "project:update", "project:delete"] as const)(
      "adds view alongside %s",
      (permission) => {
        const next = togglePermission({ selected: [], permission });

        expect(sorted(next)).toEqual(sorted([permission, "project:view"]));
      },
    );

    /** @scenario Unticking view withdraws the writes that depend on it */
    it("removes create, update and delete when view goes", () => {
      const selected: AuthzPermission[] = [
        "project:view",
        "project:create",
        "project:update",
        "project:delete",
      ];

      expect(togglePermission({ selected, permission: "project:view" })).toEqual([]);
    });

    /** @scenario Unticking manage withdraws everything it granted */
    it("empties the resource when manage goes", () => {
      const selected = permissionsForResource("project");

      expect(togglePermission({ selected, permission: "project:manage" })).toEqual([]);
    });

    /** @scenario A row ticked only because manage is sends its click to manage */
    it("toggles the manage that implies a row rather than the row", () => {
      const selected: AuthzPermission[] = ["project:manage"];

      // Clicking `view` while `manage` holds it would otherwise be a no-op: the
      // row is not in the list, so removing it removes nothing.
      expect(togglePermission({ selected, permission: "project:view" })).toEqual([]);
    });

    it("leaves an unrelated resource alone", () => {
      const selected: AuthzPermission[] = ["traces:view", "project:manage"];

      expect(togglePermission({ selected, permission: "project:manage" })).toEqual(["traces:view"]);
    });
  });

  describe("given a resource the registry narrows", () => {
    /** @scenario The editor never offers a permission the engine cannot grant */
    it("offers only view on a read-only resource", () => {
      expect(permissionsForResource("cost")).toEqual(["cost:view"]);
      expect(permissionsForResource("auditLog")).toEqual(["auditLog:view"]);
    });

    it("adds a lone write with no view to add beside it", () => {
      // Traces offer view and share; share is not a write, so it stands alone.
      expect(permissionsAddedBy("traces:share")).toEqual(["traces:share"]);
      expect(permissionsRemovedBy("traces:share")).toEqual(["traces:share"]);
    });

    it("expands manage only over what its own resource offers", () => {
      expect(sorted(permissionsAddedBy("secrets:manage"))).toEqual(
        sorted(permissionsForResource("secrets")),
      );
    });
  });

  describe("when the editor asks how a row should look", () => {
    it("separates chosen from implied", () => {
      const selected: AuthzPermission[] = ["project:manage"];

      expect(isPermissionSelected({ selected, permission: "project:manage" })).toBe(true);
      expect(isPermissionSelected({ selected, permission: "project:view" })).toBe(false);
      expect(isPermissionImplied({ selected, permission: "project:view" })).toBe(true);
      // Manage is never implied by itself.
      expect(isPermissionImplied({ selected, permission: "project:manage" })).toBe(false);
    });

    it("implies nothing on a resource with no manage", () => {
      const selected: AuthzPermission[] = ["traces:view"];

      expect(isPermissionImplied({ selected, permission: "traces:share" })).toBe(false);
    });
  });

  describe("when a click round-trips", () => {
    /** @scenario Unticking a write leaves the view it pulled in */
    it("leaves the view a write pulled in, and clears everything else", () => {
      // Rules 2 and 3 are deliberately not inverses: ticking `create` adds
      // `view` (a write nobody can read is not a grant anyone wants), but
      // unticking `create` does NOT take `view` away - only unticking
      // `view` withdraws the writes. The round trip is where this shows.
      const leftBehind: Record<string, unknown> = {};
      for (const permission of permissionsForResource("project")) {
        const on = togglePermission({ selected: [], permission });
        leftBehind[permission] = togglePermission({ selected: on, permission });
      }

      expect(leftBehind).toEqual({
        "project:manage": [],
        "project:view": [],
        "project:create": ["project:view"],
        "project:update": ["project:view"],
        "project:delete": ["project:view"],
      });
    });
  });
});
