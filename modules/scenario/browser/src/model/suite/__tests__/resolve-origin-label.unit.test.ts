/**
 * How the run history names the on-platform run set.
 * @see specs/suites/internal-run-set-surface.feature
 */
import { describe, expect, it } from "vitest";

import { resolveOriginLabel } from "../run-history-transforms.ts";

describe("resolveOriginLabel()", () => {
  const internalSetId = "__internal__proj_abc123__on-platform-scenarios";
  const suiteNameMap = new Map<string, string>();

  describe("given the internal run set of a project", () => {
    /** @scenario "The internal run set reads with a friendly name, never its raw address" */
    it("shows a readable name and never the raw address", () => {
      const label = resolveOriginLabel({ scenarioSetId: internalSetId, suiteNameMap });

      expect(label).toBeTruthy();
      expect(label).not.toBe(internalSetId);
    });

    /** @scenario "The v1 pages keep the name they show today" */
    it('keeps the v1 name "Manual Run"', () => {
      expect(resolveOriginLabel({ scenarioSetId: internalSetId, suiteNameMap })).toBe("Manual Run");
    });
  });

  describe("given an external set", () => {
    it("reads with its own set id", () => {
      expect(resolveOriginLabel({ scenarioSetId: "nightly-tests", suiteNameMap })).toBe(
        "nightly-tests",
      );
    });
  });
});
