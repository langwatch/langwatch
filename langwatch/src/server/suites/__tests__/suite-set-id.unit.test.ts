import { describe, it, expect } from "vitest";
import { getSuiteSetId, isSuiteSetId, SUITE_SET_PREFIX } from "../suite-set-id";
import { INTERNAL_SET_PREFIX } from "../../scenarios/internal-set-id";

describe("suite-set-id", () => {
  describe("getSuiteSetId()", () => {
    it("generates a set ID with the suite prefix", () => {
      const result = getSuiteSetId("suite_abc123");
      expect(result).toBe("__suite__suite_abc123");
    });
  });

  describe("isSuiteSetId()", () => {
    describe("when given a suite set ID", () => {
      it("returns true", () => {
        expect(isSuiteSetId("__suite__suite_abc123")).toBe(true);
      });
    });

    describe("when given an internal set ID", () => {
      it("returns false", () => {
        expect(
          isSuiteSetId("__internal__proj_1__on-platform-scenarios"),
        ).toBe(false);
      });
    });

    describe("when given a user set ID", () => {
      it("returns false", () => {
        expect(isSuiteSetId("my-custom-set")).toBe(false);
      });
    });
  });

  describe("namespace collision avoidance", () => {
    it("suite prefix differs from internal set prefix", () => {
      expect(SUITE_SET_PREFIX).not.toBe(INTERNAL_SET_PREFIX);
    });

    it("suite set IDs do not start with the internal prefix", () => {
      const suiteSetId = getSuiteSetId("suite_123");
      expect(suiteSetId.startsWith(INTERNAL_SET_PREFIX)).toBe(false);
    });
  });
});
