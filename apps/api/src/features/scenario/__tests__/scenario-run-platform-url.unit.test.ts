/**
 * The platform's own address for one scenario run: the results page of the
 * interface the project reads, with the `scenarioRunDetail` drawer open on
 * that run — never the external-set index page whose title is the opaque
 * internal suite id.
 *
 * Ported from
 * platform/app/src/app/api/simulation-runs/__tests__/scenario-run-platform-url.unit.test.ts
 * and
 * platform/app/src/app/api/simulation-runs/__tests__/simulation-run-platform-url.integration.test.ts
 * (origin/main), adapted from the deleted standalone `scenarioRunPlatformUrl`
 * function + `~/env.mjs` mock to the injected `createScenarioRunPlatformUrlBuilder`
 * port, which takes its origin as a plain `PlatformUrlBuilder` collaborator
 * instead of reading the environment itself.
 * See specs/langy/langy-agent-driven-navigation.feature.
 */
import { describe, expect, it, vi } from "vitest";
import type { PlatformUrlBuilder } from "@langwatch/api/rest";
import { createScenarioRunPlatformUrlBuilder } from "../scenario-run-platform-url";

function harness() {
  const platformUrl = vi.fn(
    (({ projectSlug, path }) =>
      `https://app.langwatch.ai/${projectSlug}${path}`) as PlatformUrlBuilder,
  );
  return { platformUrl, build: createScenarioRunPlatformUrlBuilder(platformUrl) };
}

describe("createScenarioRunPlatformUrlBuilder", () => {
  describe("given a project that reads the Simulations pages", () => {
    /** @scenario The platform link for a simulation run lands on that run */
    /** @scenario A simulation run's address opens the run's own detail drawer */
    it("addresses the run via the scenarioRunDetail drawer, not the results index", () => {
      const { build } = harness();

      const url = build({ projectSlug: "demo", scenarioRunId: "run_1" });

      expect(url).toBe(
        "https://app.langwatch.ai/demo/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
    });
  });

  describe("given a run whose scenario set cannot be resolved", () => {
    /** @scenario Every run gets a precise address, even when its set is unknown */
    it("still returns the run's own drawer address — the builder never asks for a set", () => {
      const { build } = harness();

      // The builder's own input shape is the proof: only projectSlug and
      // scenarioRunId are accepted, so there is no set to resolve before a
      // precise address can be produced.
      const url = build({ projectSlug: "demo", scenarioRunId: "run_1" });

      expect(url).toContain("drawer.open=scenarioRunDetail");
      expect(url).not.toMatch(/\/simulations\/[^?]/);
    });
  });
});
