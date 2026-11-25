/**
 * Which server tips a person sees beside the registry description: the ones that add to it.
 * Spec: specs/features/handled-error-presentation.feature
 */
import { describe, expect, it } from "vitest";

import { supplementalTips } from "../presentation.ts";

const description = "Narrow the time range or add a filter, then try again.";

describe("supplementalTips", () => {
  describe("when a tip only repeats part of the description", () => {
    /** @scenario "A tip that repeats our copy is dropped, one that adds to it is kept" */
    it("drops it", () => {
      expect(supplementalTips({ tips: ["Narrow the time range"], description })).toEqual([]);
    });
  });

  describe("when a tip repeats the description and adds a step", () => {
    /** @scenario "A tip that repeats our copy is dropped, one that adds to it is kept" */
    it("keeps it, since the added step is new", () => {
      const tip =
        "Narrow the time range or add a filter, then try again. If this continues, contact support.";
      expect(supplementalTips({ tips: [tip], description })).toEqual([tip]);
    });
  });

  describe("when there is no description", () => {
    it("keeps every tip for people and drops the ones naming meta", () => {
      expect(
        supplementalTips({ tips: ["Retry shortly", "Read `meta.status`"], description: "" }),
      ).toEqual(["Retry shortly"]);
    });
  });
});
