import { describe, expect, it } from "vitest";

import { requiredDataPrivacyWritePermission } from "../dataPrivacyPolicy.authz";

describe("requiredDataPrivacyWritePermission", () => {
  describe("given each scope tier", () => {
    /** @scenario A project admin cannot set an organization-wide rule */
    it("requires organization:manage for an organization rule, which project:update does not grant", () => {
      // A project admin holds project:update (the project tier's requirement)
      // but an organization rule requires organization:manage, so the save is
      // rejected for them.
      expect(requiredDataPrivacyWritePermission("ORGANIZATION")).toBe(
        "organization:manage",
      );
      expect(requiredDataPrivacyWritePermission("PROJECT")).toBe(
        "project:update",
      );
      expect(requiredDataPrivacyWritePermission("ORGANIZATION")).not.toBe(
        requiredDataPrivacyWritePermission("PROJECT"),
      );
    });
  });

  it("maps departments to organization:manage and teams to team:manage", () => {
    expect(requiredDataPrivacyWritePermission("DEPARTMENT")).toBe(
      "organization:manage",
    );
    expect(requiredDataPrivacyWritePermission("TEAM")).toBe("team:manage");
  });
});
