import { beforeEach, describe, expect, it, vi } from "vitest";
import { scenarioRunPlatformUrl } from "../scenario-run-platform-url";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { BASE_HOST: "https://app.langwatch.ai" as string | undefined },
}));

vi.mock("~/env.mjs", () => ({ env: mockEnv }));

describe("scenarioRunPlatformUrl", () => {
  beforeEach(() => {
    mockEnv.BASE_HOST = "https://app.langwatch.ai";
  });

  describe("given a scenario run", () => {
    /** @scenario "A simulation run's address opens the run's own detail drawer" */
    it("addresses the run via the scenarioRunDetail drawer on the simulations route", () => {
      const url = scenarioRunPlatformUrl({
        projectSlug: "demo",
        scenarioRunId: "run_1",
      });

      expect(url).toBe(
        "https://app.langwatch.ai/demo/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
    });

    it("percent-encodes a run id that carries query-unsafe characters", () => {
      const url = scenarioRunPlatformUrl({
        projectSlug: "demo",
        scenarioRunId: "run?1&2",
      });

      expect(url).toBe(
        "https://app.langwatch.ai/demo/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run%3F1%262",
      );
    });
  });

  describe("given a run whose set is not resolved", () => {
    /** @scenario "Every run gets a precise address, even when its set is unknown" */
    // The drawer address needs only the run id, so a missing set no longer
    // degrades to the bare index — every run still gets its own precise link.
    it("still returns the run's own drawer address, not the index", () => {
      // The set is no longer even an input — the drawer address is run-id
      // only — so every run gets its own precise link with nothing else to
      // resolve.
      const url = scenarioRunPlatformUrl({
        projectSlug: "demo",
        scenarioRunId: "run_1",
      });

      expect(url).toBe(
        "https://app.langwatch.ai/demo/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
    });
  });
});
