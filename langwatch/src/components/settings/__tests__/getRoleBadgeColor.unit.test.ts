import { describe, expect, it } from "vitest";
import { OrganizationUserRole } from "@prisma/client";
import { getRoleBadgeColor } from "../../roles/RoleBadge";

describe("getRoleBadgeColor()", () => {
  describe("when role is ADMIN", () => {
    it("returns blue", () => {
      expect(getRoleBadgeColor(OrganizationUserRole.ADMIN)).toBe("blue");
    });
  });

  describe("when role is MEMBER", () => {
    it("returns blue", () => {
      expect(getRoleBadgeColor(OrganizationUserRole.MEMBER)).toBe("blue");
    });
  });

  describe("when role is EXTERNAL", () => {
    it("returns orange", () => {
      expect(getRoleBadgeColor(OrganizationUserRole.EXTERNAL)).toBe("orange");
    });
  });
});
