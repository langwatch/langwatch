import { describe, expect, it } from "vitest";
import { ROLE_HIERARCHY, rolesUpTo } from "../CreatePatDrawer";

describe("rolesUpTo", () => {
  describe("when ceiling is a standard role", () => {
    it("returns only VIEWER for VIEWER ceiling", () => {
      expect(rolesUpTo("VIEWER")).toEqual(["VIEWER"]);
    });

    it("returns VIEWER and MEMBER for MEMBER ceiling", () => {
      expect(rolesUpTo("MEMBER")).toEqual(["VIEWER", "MEMBER"]);
    });

    it("returns all standard roles for ADMIN ceiling", () => {
      expect(rolesUpTo("ADMIN")).toEqual(["VIEWER", "MEMBER", "ADMIN"]);
    });
  });

  describe("when ceiling is CUSTOM", () => {
    it("returns a single-item array with the custom value", () => {
      expect(rolesUpTo("CUSTOM")).toEqual(["CUSTOM"]);
    });
  });

  describe("when ceiling is an unknown value", () => {
    it("returns a single-item array with the unknown value", () => {
      expect(rolesUpTo("UNKNOWN")).toEqual(["UNKNOWN"]);
    });
  });

  it("preserves ROLE_HIERARCHY order", () => {
    expect(ROLE_HIERARCHY).toEqual(["VIEWER", "MEMBER", "ADMIN"]);
  });
});
