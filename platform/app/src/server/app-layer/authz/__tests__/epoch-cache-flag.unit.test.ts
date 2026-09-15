import { describe, expect, it } from "vitest";
import { isEpochCacheEnabled } from "../epoch-cache-flag";

describe("isEpochCacheEnabled", () => {
  describe("given no operator has touched the variable", () => {
    /** @scenario "The grants cache is on unless an operator turns it off" */
    it("leaves the cache on when the variable is unset", () => {
      expect(isEpochCacheEnabled(undefined)).toBe(true);
    });

    it("reads an empty value the same as unset", () => {
      expect(isEpochCacheEnabled("")).toBe(true);
    });

    it("reads whitespace the same as unset", () => {
      expect(isEpochCacheEnabled("   ")).toBe(true);
    });
  });

  describe("when the value asks for the cache", () => {
    it.each([
      "1",
      "true",
      "TRUE",
      " yes ",
    ])("keeps the cache on for %s", (raw) => {
      expect(isEpochCacheEnabled(raw)).toBe(true);
    });
  });

  describe("when an operator pulls the kill switch", () => {
    it.each([
      "0",
      "false",
      "off",
      "no",
    ])("turns the cache off for %s", (raw) => {
      expect(isEpochCacheEnabled(raw)).toBe(false);
    });
  });

  describe("when the kill switch arrives shouted or padded", () => {
    /** @scenario "The kill switch works however an operator spells it" */
    it.each([
      "FALSE",
      "False",
      "OFF",
      "No",
      " 0 ",
      "  false  ",
      "0 ",
    ])("still turns the cache off for %s", (raw) => {
      expect(isEpochCacheEnabled(raw)).toBe(false);
    });
  });

  describe("when the value is none of the spellings it knows", () => {
    /** @scenario "An unrecognised setting is not read as an instruction to stop" */
    it.each([
      "disabled",
      "none",
      "nope",
      "0.0",
      "2",
      "of",
    ])("fails toward the default and stays on for %s", (raw) => {
      expect(isEpochCacheEnabled(raw)).toBe(true);
    });
  });
});
