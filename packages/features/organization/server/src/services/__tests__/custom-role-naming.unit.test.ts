import { describe, expect, it } from "vitest";
import { isCustomRole } from "../custom-role-naming";

describe("isCustomRole", () => {
  it("returns true for custom role strings", () => {
    expect(isCustomRole("custom:abc")).toBe(true);
  });

  describe("when role is not a custom role", () => {
    it.each(["ADMIN", "MEMBER", "VIEWER", ""])("returns false for %s", (role) => {
      expect(isCustomRole(role)).toBe(false);
    });
  });
});
