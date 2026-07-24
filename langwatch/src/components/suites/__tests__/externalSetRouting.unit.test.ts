/**
 * @vitest-environment jsdom
 *
 * Unit tests for external set routing utilities.
 *
 * @see specs/features/suites/external-sdk-ci-sets-in-sidebar.feature
 */
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_SET_PREFIX,
  extractExternalSetId,
  isExternalSetSelection,
  toExternalSetSelection,
} from "../useSuiteRouting";

describe("external set routing utilities", () => {
  describe("toExternalSetSelection()", () => {
    it("prefixes the scenarioSetId with the external prefix", () => {
      expect(toExternalSetSelection("nightly-regression")).toBe(
        `${EXTERNAL_SET_PREFIX}nightly-regression`,
      );
    });
  });

  describe("isExternalSetSelection()", () => {
    describe("when given an external set selection", () => {
      it("returns true", () => {
        expect(
          isExternalSetSelection(toExternalSetSelection("some-set")),
        ).toBe(true);
      });
    });

    describe("when given a suite slug", () => {
      it("returns false", () => {
        expect(isExternalSetSelection("my-suite-slug")).toBe(false);
      });
    });

    describe("when given the all-runs ID", () => {
      it("returns false", () => {
        expect(isExternalSetSelection("all-runs")).toBe(false);
      });
    });
  });

  describe("extractExternalSetId()", () => {
    it("removes the external prefix to return the raw scenarioSetId", () => {
      const selection = toExternalSetSelection("ci-smoke-tests");
      expect(extractExternalSetId(selection)).toBe("ci-smoke-tests");
    });
  });
});
