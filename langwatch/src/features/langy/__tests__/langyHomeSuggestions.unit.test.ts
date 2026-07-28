/**
 * The asks escalate with what the project can actually act on — on the home
 * page's capability row AND the panel's empty state, which share the one
 * selection.
 *
 * Spec: specs/home/langy-home.feature,
 * specs/langy/langy-empty-state-suggestions.feature
 */
import { describe, expect, it } from "vitest";
import {
  SETUP_SUGGESTIONS,
  SUGGESTIONS,
} from "../components/EmptyState";
import {
  HOME_SUGGESTION_COUNT,
  PANEL_SUGGESTION_COUNT,
  selectLangySuggestions,
} from "../logic/langyHomeSuggestions";

const NOTHING = {
  hasTraces: false,
  hasEvaluations: false,
  hasExperiments: false,
};
const EVERYTHING = {
  hasTraces: true,
  hasEvaluations: true,
  hasExperiments: true,
};

describe("selectLangySuggestions", () => {
  it("always offers a full row", () => {
    for (const reach of [
      NOTHING,
      { ...NOTHING, hasTraces: true },
      { ...NOTHING, hasTraces: true, hasEvaluations: true },
      EVERYTHING,
    ]) {
      expect(selectLangySuggestions({ reach })).toHaveLength(
        HOME_SUGGESTION_COUNT,
      );
    }
  });

  describe("given a project with nothing in it", () => {
    /** @scenario A project with nothing in it yet still opens with the composer */
    it("offers ways to get set up, never asks about data that is not there", () => {
      const chosen = selectLangySuggestions({ reach: NOTHING });

      expect(chosen).toEqual(SETUP_SUGGESTIONS.slice(0, HOME_SUGGESTION_COUNT));
      expect(chosen.every((s) => !s.requires)).toBe(true);
      expect(chosen.map((s) => s.label)).toContain("Onboard your agent");
    });
  });

  describe("given a project with traces but nothing built on them", () => {
    it("offers what traces alone support, and tops the row up with setup", () => {
      const chosen = selectLangySuggestions({
        reach: { ...NOTHING, hasTraces: true },
      });

      // Nothing that needs evaluations or experiment runs to land on.
      expect(chosen.some((s) => s.requires === "evaluations")).toBe(false);
      expect(chosen.some((s) => s.requires === "experiments")).toBe(false);
      expect(chosen.some((s) => s.requires === "traces")).toBe(true);
    });

    it("withdraws the onboarding ask the moment the first trace exists", () => {
      const chosen = selectLangySuggestions({
        reach: { ...NOTHING, hasTraces: true },
        count: PANEL_SUGGESTION_COUNT,
      });

      expect(chosen.map((s) => s.label)).not.toContain("Onboard your agent");
    });
  });

  describe("given a project that has traces and evaluations", () => {
    /** @scenario The asks grow with what the project can act on */
    it("offers an ask that lands on those evaluations", () => {
      const chosen = selectLangySuggestions({
        reach: {
          ...NOTHING,
          hasTraces: true,
          hasEvaluations: true,
        },
      });

      expect(chosen.some((s) => s.requires === "evaluations")).toBe(true);
    });

    it("no longer offers to choose what to measure — that gap has closed", () => {
      const chosen = selectLangySuggestions({
        reach: { ...NOTHING, hasTraces: true, hasEvaluations: true },
        count: PANEL_SUGGESTION_COUNT,
      });

      expect(chosen.map((s) => s.label)).not.toContain(
        "Choose what to measure",
      );
    });
  });

  describe("given a project that has reached everything", () => {
    /** @scenario The example asks are the ones Langy actually offers */
    it("leads with the most capable ask and drops the setup asks", () => {
      const chosen = selectLangySuggestions({ reach: EVERYTHING });

      expect(chosen[0]?.requires).toBe("experiments");
      expect(
        chosen.some((s) => SETUP_SUGGESTIONS.some((x) => x.label === s.label)),
      ).toBe(false);
    });

    it("never invents an ask the panel does not itself offer", () => {
      const offered = [...SUGGESTIONS, ...SETUP_SUGGESTIONS].map(
        (s) => s.prompt,
      );

      for (const reach of [NOTHING, EVERYTHING]) {
        for (const suggestion of selectLangySuggestions({ reach })) {
          expect(offered).toContain(suggestion.prompt);
        }
      }
    });
  });

  describe("given the panel's wider row", () => {
    /** @scenario A project that has reached everything sees the full range */
    it("shows a fully-reached project every real ask", () => {
      const chosen = selectLangySuggestions({
        reach: EVERYTHING,
        count: PANEL_SUGGESTION_COUNT,
      });

      expect(chosen).toHaveLength(SUGGESTIONS.length);
      expect(chosen.map((s) => s.label).toSorted()).toEqual(
        SUGGESTIONS.map((s) => s.label).toSorted(),
      );
    });
  });

  describe("when the project gains capability", () => {
    it("never shows a project with data how to onboard its agent", () => {
      const chosen = selectLangySuggestions({ reach: EVERYTHING });

      expect(chosen.map((s) => s.label)).not.toContain("Onboard your agent");
    });
  });
});
