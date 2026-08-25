// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";
import { resolveHighestRole } from "../src/scim-role-resolver";

describe("resolveHighestRole()", () => {
  describe("when resolving built-in roles", () => {
    /** @scenario User with multiple roles resolves to the most permissive */
    it("picks MEMBER over VIEWER", () => {
      const result = resolveHighestRole(["VIEWER", "MEMBER"]);

      expect(result).toBe("MEMBER");
    });

    it("picks ADMIN over MEMBER", () => {
      const result = resolveHighestRole(["MEMBER", "ADMIN"]);

      expect(result).toBe("ADMIN");
    });

    /** @scenario Role hierarchy resolves ADMIN as most permissive */
    it("picks ADMIN over all roles", () => {
      const result = resolveHighestRole(["VIEWER", "MEMBER", "ADMIN"]);

      expect(result).toBe("ADMIN");
    });
  });

  describe("when a role mapping is removed", () => {
    /** @scenario Removing a binding recalculates to remaining most permissive */
    it("recalculates to remaining most permissive role", () => {
      // Originally [VIEWER, MEMBER], MEMBER mapping removed → only VIEWER remains
      const remainingRoles = ["VIEWER"];

      const result = resolveHighestRole(remainingRoles);

      expect(result).toBe("VIEWER");
    });
  });

  describe("when verifying hierarchy ordering", () => {
    /** @scenario Role hierarchy ordering */
    it("ranks ADMIN above MEMBER", () => {
      expect(resolveHighestRole(["MEMBER", "ADMIN"])).toBe("ADMIN");
    });

    it("ranks MEMBER above VIEWER", () => {
      expect(resolveHighestRole(["VIEWER", "MEMBER"])).toBe("MEMBER");
    });
  });

  describe("when CUSTOM roles are present", () => {
    it("returns the built-in role when mixed with CUSTOM", () => {
      const result = resolveHighestRole(["CUSTOM", "VIEWER"]);

      expect(result).toBe("VIEWER");
    });

    it("returns CUSTOM when only CUSTOM roles are present", () => {
      const result = resolveHighestRole(["CUSTOM", "CUSTOM"]);

      expect(result).toBe("CUSTOM");
    });
  });

  describe("when roles array is empty", () => {
    it("throws an error", () => {
      expect(() => resolveHighestRole([])).toThrow(
        "Cannot resolve highest role from an empty array",
      );
    });
  });
});
