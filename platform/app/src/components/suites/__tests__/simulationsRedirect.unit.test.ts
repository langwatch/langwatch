/**
 * Anything under /simulations that is not a known shape is read as an external
 * SET slug, so a near-miss URL renders an empty run history instead of the page
 * the user meant. These pin the redirects that catch the near-misses.
 *
 * @see specs/langy/langy-capability-cards.feature
 */
import { describe, expect, it } from "vitest";
import { resolveSimulationsRedirect } from "../useSuiteRouting";

const redirect = (segments: string[], query: Record<string, unknown> = {}) =>
  resolveSimulationsRedirect({ projectSlug: "acme", segments, query });

describe("resolveSimulationsRedirect", () => {
  describe("given a known simulations shape", () => {
    it("renders the run history as it stands", () => {
      expect(redirect([])).toBeNull();
    });

    it("renders a suite detail as it stands", () => {
      expect(redirect(["run-plans", "nightly"])).toBeNull();
    });

    it("renders an external set as it stands", () => {
      expect(redirect(["my-set"])).toBeNull();
    });
  });

  describe("given a URL that meant the scenario library", () => {
    it("sends the library's near-miss to the library", () => {
      expect(redirect(["scenarios", "scenario_1"])).toBe(
        "/acme/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=scenario_1",
      );
    });

    it("sends the singular spelling to the library", () => {
      expect(redirect(["scenario"])).toBe("/acme/simulations/scenarios");
    });

    it("escapes an id that would otherwise break the query string", () => {
      expect(redirect(["scenarios", "a b&c"])).toBe(
        "/acme/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=a%20b%26c",
      );
    });
  });

  describe("given a legacy suites URL", () => {
    it("sends a named suite to its run plan", () => {
      expect(redirect(["suites"], { suite: "nightly" })).toBe(
        "/acme/simulations/run-plans/nightly",
      );
    });

    it("sends a named external set to that set", () => {
      expect(redirect(["suites"], { externalSet: "my-set" })).toBe(
        "/acme/simulations/my-set",
      );
    });

    it("sends an unnamed one to the run history", () => {
      expect(redirect(["suites"])).toBe("/acme/simulations");
    });
  });

  describe("given the old per-run URL", () => {
    it("opens the run's drawer on its batch", () => {
      expect(redirect(["my-set", "batch_1", "run_1"])).toBe(
        "/acme/simulations/my-set/batch_1?openRun=run_1",
      );
    });

    it("leaves a suite batch alone", () => {
      expect(redirect(["run-plans", "nightly", "batch_1"])).toBeNull();
    });
  });
});
