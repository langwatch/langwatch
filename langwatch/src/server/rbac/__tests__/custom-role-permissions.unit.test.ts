import { describe, expect, it } from "vitest";
import {
  MalformedCustomRolePermissionsError,
  parseCustomRolePermissions,
} from "../custom-role-permissions";

describe("parseCustomRolePermissions", () => {
  const customRoleId = "custom-role-1";

  describe("when permissions is a valid array of resource:action strings", () => {
    it("returns the parsed permissions", () => {
      const result = parseCustomRolePermissions({
        customRoleId,
        permissions: ["traces:view", "annotations:manage"],
      });
      expect(result).toEqual(["traces:view", "annotations:manage"]);
    });

    it("returns an empty array when given an empty array", () => {
      expect(
        parseCustomRolePermissions({
          customRoleId,
          permissions: [],
        }),
      ).toEqual([]);
    });
  });

  describe("when permissions is not an array", () => {
    it("throws MalformedCustomRolePermissionsError for null", () => {
      expect(() =>
        parseCustomRolePermissions({ customRoleId, permissions: null }),
      ).toThrow(MalformedCustomRolePermissionsError);
    });

    it("throws MalformedCustomRolePermissionsError for undefined", () => {
      expect(() =>
        parseCustomRolePermissions({ customRoleId, permissions: undefined }),
      ).toThrow(MalformedCustomRolePermissionsError);
    });

    it("throws MalformedCustomRolePermissionsError for an object", () => {
      expect(() =>
        parseCustomRolePermissions({
          customRoleId,
          permissions: { traces: "view" },
        }),
      ).toThrow(MalformedCustomRolePermissionsError);
    });

    it("throws MalformedCustomRolePermissionsError for a bare string", () => {
      expect(() =>
        parseCustomRolePermissions({
          customRoleId,
          permissions: "traces:view",
        }),
      ).toThrow(MalformedCustomRolePermissionsError);
    });
  });

  describe("when permissions array contains non-string elements", () => {
    it("throws for numeric entries", () => {
      expect(() =>
        parseCustomRolePermissions({
          customRoleId,
          permissions: ["traces:view", 42],
        }),
      ).toThrow(MalformedCustomRolePermissionsError);
    });

    it("throws for null entries", () => {
      expect(() =>
        parseCustomRolePermissions({
          customRoleId,
          permissions: ["traces:view", null],
        }),
      ).toThrow(MalformedCustomRolePermissionsError);
    });
  });

  describe("when permissions array contains shape-invalid strings", () => {
    it("throws for strings without a colon", () => {
      expect(() =>
        parseCustomRolePermissions({
          customRoleId,
          permissions: ["tracesview"],
        }),
      ).toThrow(MalformedCustomRolePermissionsError);
    });

    it("throws for strings with uppercase characters", () => {
      expect(() =>
        parseCustomRolePermissions({
          customRoleId,
          permissions: ["Traces:View"],
        }),
      ).toThrow(MalformedCustomRolePermissionsError);
    });

    it("throws for strings with extra segments", () => {
      expect(() =>
        parseCustomRolePermissions({
          customRoleId,
          permissions: ["traces:view:extra"],
        }),
      ).toThrow(MalformedCustomRolePermissionsError);
    });
  });

  describe("error shape", () => {
    it("includes customRoleId in the thrown error's meta", () => {
      try {
        parseCustomRolePermissions({
          customRoleId,
          permissions: "not-an-array",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedCustomRolePermissionsError);
        expect((err as MalformedCustomRolePermissionsError).kind).toBe(
          "malformed_custom_role_permissions",
        );
        expect((err as MalformedCustomRolePermissionsError).meta).toMatchObject(
          { customRoleId },
        );
        return;
      }
      throw new Error("expected parseCustomRolePermissions to throw");
    });
  });
});
