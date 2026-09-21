// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { mergeNameParts, namePartsIn, namesAName } from "../scim-name.rules.ts";

describe("mergeNameParts", () => {
  describe("when only the family name is patched", () => {
    /** @scenario "A patch naming only the surname keeps the forename" */
    it("keeps the given name it did not mention", () => {
      expect(mergeNameParts({ current: "Ada Lovelace", familyName: "Byron" })).toEqual({
        changed: true,
        name: "Ada Byron",
      });
    });
  });

  describe("when only the given name is patched", () => {
    it("keeps the rest of the stored name", () => {
      expect(mergeNameParts({ current: "Ada King Lovelace", givenName: "Augusta" })).toEqual({
        changed: true,
        name: "Augusta King Lovelace",
      });
    });
  });

  describe("when neither half is named", () => {
    it("leaves the name alone", () => {
      expect(mergeNameParts({ current: "Ada Lovelace" })).toEqual({ changed: false });
      expect(mergeNameParts({ current: "Ada Lovelace", givenName: "" })).toEqual({
        changed: false,
      });
    });
  });

  describe("when nothing is stored yet", () => {
    it("takes the half it was given", () => {
      expect(mergeNameParts({ current: "", familyName: "Byron" })).toEqual({
        changed: true,
        name: "Byron",
      });
    });
  });
});

describe("namePartsIn", () => {
  describe("when the family name arrives as a dotted path with a scalar", () => {
    /** @scenario "A patch sending the family name as a dotted path is applied" */
    it("reads the half the path names", () => {
      expect(namePartsIn({ path: "name.familyName", value: "Byron" })).toEqual({
        familyName: "Byron",
      });
    });
  });

  describe("when the parts arrive unwrapped under a name path", () => {
    it("reads both halves", () => {
      expect(
        namePartsIn({ path: "name", value: { givenName: "Ada", familyName: "Byron" } }),
      ).toEqual({ givenName: "Ada", familyName: "Byron" });
    });
  });

  describe("when the parts arrive nested or dotted with no path", () => {
    it("reads either spelling", () => {
      expect(namePartsIn({ path: void 0, value: { name: { givenName: "Ada" } } })).toEqual({
        givenName: "Ada",
      });
      expect(namePartsIn({ path: void 0, value: { "name.familyName": "Byron" } })).toEqual({
        familyName: "Byron",
      });
    });
  });

  describe("when the operation names no name at all", () => {
    it("reads nothing", () => {
      expect(namesAName(namePartsIn({ path: "active", value: false }))).toBe(false);
      expect(namesAName(namePartsIn({ path: void 0, value: { userName: "ada@acme.test" } }))).toBe(
        false,
      );
    });
  });
});
