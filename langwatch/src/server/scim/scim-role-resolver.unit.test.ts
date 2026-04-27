import { describe, expect, it } from "vitest";
import { TeamUserRole } from "@prisma/client";
import { resolveHighestRole } from "./scim-role-resolver";

describe("resolveHighestRole()", () => {
  describe("when resolving built-in roles", () => {
    it("picks MEMBER over VIEWER", () => {
      const result = resolveHighestRole([
        TeamUserRole.VIEWER,
        TeamUserRole.MEMBER,
      ]);

      expect(result).toBe(TeamUserRole.MEMBER);
    });

    it("picks ADMIN over MEMBER", () => {
      const result = resolveHighestRole([
        TeamUserRole.MEMBER,
        TeamUserRole.ADMIN,
      ]);

      expect(result).toBe(TeamUserRole.ADMIN);
    });

    it("picks ADMIN over all roles", () => {
      const result = resolveHighestRole([
        TeamUserRole.VIEWER,
        TeamUserRole.MEMBER,
        TeamUserRole.ADMIN,
      ]);

      expect(result).toBe(TeamUserRole.ADMIN);
    });
  });

  describe("when a role mapping is removed", () => {
    it("recalculates to remaining most permissive role", () => {
      // Originally [VIEWER, MEMBER], MEMBER mapping removed → only VIEWER remains
      const remainingRoles = [TeamUserRole.VIEWER];

      const result = resolveHighestRole(remainingRoles);

      expect(result).toBe(TeamUserRole.VIEWER);
    });
  });

  describe("when verifying hierarchy ordering", () => {
    it("ranks ADMIN above MEMBER", () => {
      expect(resolveHighestRole([TeamUserRole.MEMBER, TeamUserRole.ADMIN])).toBe(
        TeamUserRole.ADMIN
      );
    });

    it("ranks MEMBER above VIEWER", () => {
      expect(
        resolveHighestRole([TeamUserRole.VIEWER, TeamUserRole.MEMBER])
      ).toBe(TeamUserRole.MEMBER);
    });
  });

  describe("when CUSTOM roles are present", () => {
    it("returns the built-in role when mixed with CUSTOM", () => {
      const result = resolveHighestRole([
        TeamUserRole.CUSTOM,
        TeamUserRole.VIEWER,
      ]);

      expect(result).toBe(TeamUserRole.VIEWER);
    });

    it("returns CUSTOM when only CUSTOM roles are present", () => {
      const result = resolveHighestRole([
        TeamUserRole.CUSTOM,
        TeamUserRole.CUSTOM,
      ]);

      expect(result).toBe(TeamUserRole.CUSTOM);
    });
  });

  describe("when roles array is empty", () => {
    it("throws an error", () => {
      expect(() => resolveHighestRole([])).toThrow(
        "Cannot resolve highest role from an empty array"
      );
    });
  });
});
