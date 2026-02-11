/**
 * Unit tests for getOrgRoleOptionsForUser pure function.
 *
 * Covers the @unit scenarios from specs/members/update-pending-invitation.feature:
 * - Non-admin user sees restricted role options in invite form
 * - Admin user sees all role options in invite form
 */
import { describe, expect, it } from "vitest";
import { getOrgRoleOptionsForUser } from "../getOrgRoleOptionsForUser";

describe("getOrgRoleOptionsForUser()", () => {
  describe("when user is a non-admin", () => {
    it("returns only Member and Lite Member options", () => {
      const options = getOrgRoleOptionsForUser({ isAdmin: false });

      const labels = options.map((o) => o.label);
      expect(labels).toContain("Member");
      expect(labels).toContain("Lite Member");
      expect(labels).toHaveLength(2);
    });

    it("does not include Admin as a role option", () => {
      const options = getOrgRoleOptionsForUser({ isAdmin: false });

      const labels = options.map((o) => o.label);
      expect(labels).not.toContain("Admin");
    });
  });

  describe("when user is an admin", () => {
    it("returns Admin, Member, and Lite Member options", () => {
      const options = getOrgRoleOptionsForUser({ isAdmin: true });

      const labels = options.map((o) => o.label);
      expect(labels).toContain("Admin");
      expect(labels).toContain("Member");
      expect(labels).toContain("Lite Member");
      expect(labels).toHaveLength(3);
    });
  });
});
