import { describe, expect, it } from "vitest";
import {
  GUIDED_PATH_DESCRIPTIONS,
  GUIDED_PATHS,
  guidedPathLanding,
} from "../paths";

/**
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature
 */
describe("guidedPathLanding", () => {
  describe("when the provider step is over", () => {
    /** @scenario "Each path lands on its own page" */
    it("lands each path on its own page, the project pages with the slug", () => {
      expect(guidedPathLanding({ path: "llmops", projectSlug: "acme" })).toBe(
        "/acme/traces",
      );
      expect(guidedPathLanding({ path: "gateway", projectSlug: "acme" })).toBe(
        "/gateway",
      );
      expect(
        guidedPathLanding({ path: "governance", projectSlug: "acme" }),
      ).toBe("/governance");
      expect(guidedPathLanding({ path: "coding", projectSlug: "acme" })).toBe(
        "/me",
      );
    });
  });
});

describe("the value screen copy", () => {
  /** @scenario "The four paths are offered with their titles and descriptions" */
  it("carries one description per path, verbatim from the prototype", () => {
    expect(GUIDED_PATHS.map((p) => GUIDED_PATH_DESCRIPTIONS[p])).toEqual([
      "Trace, test and improve the agents you are building",
      "Track Claude Code and friends and find token savings",
      "One endpoint for every provider, with virtual keys, budgets and routing",
      "Control all AI subscriptions and usage across company departments",
    ]);
  });
});
