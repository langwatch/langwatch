import { describe, it, expect } from "vitest";
import {
  getSuiteSetId,
  isSuiteSetId,
  extractSuiteId,
  SUITE_SET_SUFFIX,
} from "../suite-set-id";
import { INTERNAL_SET_PREFIX } from "../../scenarios/internal-set-id";

describe("suite-set-id", () => {
  describe("getSuiteSetId()", () => {
    it("generates a set ID with internal prefix and suite suffix", () => {
      const result = getSuiteSetId("suite_abc123");
      expect(result).toBe("__internal__suite_abc123__suite");
    });
  });

  describe("isSuiteSetId()", () => {
    describe("when given a suite set ID", () => {
      it("returns true", () => {
        expect(isSuiteSetId("__internal__suite_abc123__suite")).toBe(true);
      });
    });

    describe("when given an on-platform internal set ID", () => {
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

  describe("extractSuiteId()", () => {
    describe("when given a suite set ID", () => {
      it("extracts the suite ID", () => {
        expect(extractSuiteId("__internal__suite_abc123__suite")).toBe(
          "suite_abc123",
        );
      });
    });

    describe("when given a non-suite set ID", () => {
      it("returns null", () => {
        expect(extractSuiteId("__internal__proj_1__on-platform-scenarios")).toBe(
          null,
        );
        expect(extractSuiteId("my-custom-set")).toBe(null);
      });
    });
  });

  describe("namespace structure", () => {
    it("suite set IDs start with the internal prefix", () => {
      const suiteSetId = getSuiteSetId("suite_123");
      expect(suiteSetId.startsWith(INTERNAL_SET_PREFIX)).toBe(true);
    });

    it("suite set IDs end with the suite suffix", () => {
      const suiteSetId = getSuiteSetId("suite_123");
      expect(suiteSetId.endsWith(SUITE_SET_SUFFIX)).toBe(true);
    });

    it("suite set IDs are distinguishable from on-platform set IDs", () => {
      const suiteSetId = getSuiteSetId("suite_123");
      const onPlatformSetId = "__internal__proj_123__on-platform-scenarios";
      expect(isSuiteSetId(suiteSetId)).toBe(true);
      expect(isSuiteSetId(onPlatformSetId)).toBe(false);
    });
  });
});
