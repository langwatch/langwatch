import { describe, expect, it } from "vitest";
import {
  declaredScopeId,
  isPlatformTierPermission,
  permissionGrantTiers,
} from "../declaration";

describe("permissionGrantTiers", () => {
  describe("given a project-grantable permission", () => {
    it("lists the tiers most specific first", () => {
      expect(permissionGrantTiers("traces:view")).toEqual([
        "project",
        "team",
        "organization",
      ]);
    });
  });

  describe("given an organization-only permission", () => {
    it("lists only the organization tier", () => {
      expect(permissionGrantTiers("governance:view")).toEqual(["organization"]);
      expect(permissionGrantTiers("organization:manage")).toEqual([
        "organization",
      ]);
    });
  });

  describe("given a platform-tier permission", () => {
    it("lists no input-addressable tier", () => {
      expect(permissionGrantTiers("ops:view")).toEqual([]);
      expect(isPlatformTierPermission("ops:view")).toBe(true);
      expect(isPlatformTierPermission("traces:view")).toBe(false);
    });
  });
});

describe("declaredScopeId", () => {
  describe("when the input carries ids at several allowed tiers", () => {
    it("resolves the most specific tier the permission allows", () => {
      expect(
        declaredScopeId({
          permission: "traces:view",
          input: { projectId: "proj_1", organizationId: "org_1" },
        }),
      ).toEqual({ tier: "project", id: "proj_1" });
    });
  });

  describe("when the permission is organization-only and the input carries a projectId too", () => {
    it("ignores the tier the permission cannot be granted at", () => {
      expect(
        declaredScopeId({
          permission: "organization:manage",
          input: { projectId: "proj_1", organizationId: "org_1" },
        }),
      ).toEqual({ tier: "organization", id: "org_1" });
    });
  });

  describe("when a via field is declared", () => {
    it("resolves the named field at its own tier", () => {
      expect(
        declaredScopeId({
          permission: "organization:manage",
          input: { teamId: "team_1" },
          via: "teamId",
        }),
      ).toEqual({ tier: "team", id: "team_1" });
    });

    it("returns null when the named field is absent or empty", () => {
      expect(
        declaredScopeId({
          permission: "organization:manage",
          input: { teamId: "" },
          via: "teamId",
        }),
      ).toBeNull();
      expect(
        declaredScopeId({
          permission: "organization:manage",
          input: {},
          via: "teamId",
        }),
      ).toBeNull();
    });
  });

  describe("when the input carries no id the permission can use", () => {
    it("returns null so the caller treats it as a wiring bug", () => {
      expect(
        declaredScopeId({ permission: "governance:view", input: {} }),
      ).toBeNull();
      expect(
        declaredScopeId({
          permission: "governance:view",
          input: { projectId: "proj_1" },
        }),
      ).toBeNull();
    });

    it("never reads a non-string id", () => {
      expect(
        declaredScopeId({
          permission: "traces:view",
          input: { projectId: 42 as unknown as string },
        }),
      ).toBeNull();
    });
  });
});
