// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { assertRemovalKeepsAnAdministrator } from "../scim-last-administrator.rules.ts";

describe("assertRemovalKeepsAnAdministrator", () => {
  describe("given the user is the only active administrator", () => {
    it("refuses with cannot_remove_last_admin", () => {
      expect(() =>
        assertRemovalKeepsAnAdministrator({ administrators: ["ada"], userId: "ada" }),
      ).toThrow(expect.objectContaining({ code: "cannot_remove_last_admin" }));
    });
  });

  describe("given another active administrator remains", () => {
    it("allows the removal", () => {
      expect(() =>
        assertRemovalKeepsAnAdministrator({ administrators: ["ada", "bo"], userId: "ada" }),
      ).not.toThrow();
    });
  });

  describe("given the user is not an active administrator", () => {
    it("allows the removal, even when nobody administers", () => {
      expect(() =>
        assertRemovalKeepsAnAdministrator({ administrators: [], userId: "ada" }),
      ).not.toThrow();
      expect(() =>
        assertRemovalKeepsAnAdministrator({ administrators: ["bo"], userId: "ada" }),
      ).not.toThrow();
    });
  });
});
