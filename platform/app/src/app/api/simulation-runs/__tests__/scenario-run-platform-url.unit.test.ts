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

  describe("given a project that reads the Simulations pages", () => {
    /** @scenario "A simulation run's address opens the run's own detail drawer" */
    it("addresses the run via the scenarioRunDetail drawer on the simulations route", () => {
      const url = scenarioRunPlatformUrl({
        projectSlug: "demo",
        scenarioRunId: "run_1",
        ui: "simulations",
      });

      expect(url).toBe(
        "https://app.langwatch.ai/demo/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
    });

    it("percent-encodes a run id that carries query-unsafe characters", () => {
      const url = scenarioRunPlatformUrl({
        projectSlug: "demo",
        scenarioRunId: "run?1&2",
        ui: "simulations",
      });

      expect(url).toBe(
        "https://app.langwatch.ai/demo/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run%3F1%262",
      );
    });
  });

  describe("given a project that reads Agent Testing", () => {
    it("addresses the run via the same drawer over the Agent Testing results", () => {
      const url = scenarioRunPlatformUrl({
        projectSlug: "demo",
        scenarioRunId: "run_1",
        ui: "agent_testing",
      });

      expect(url).toBe(
        "https://app.langwatch.ai/demo/agent-testing/results?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
    });
  });

  describe("given a run whose set is not resolved", () => {
    /** @scenario "Every run gets a precise address, even when its set is unknown" */
    // The drawer address needs only the run id, so a missing set does not
    // degrade to the bare index: every run still gets its own precise link.
    it("still returns the run's own drawer address, not the index", () => {
      const url = scenarioRunPlatformUrl({
        projectSlug: "demo",
        scenarioRunId: "run_1",
        ui: "simulations",
      });

      expect(url).toBe(
        "https://app.langwatch.ai/demo/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
    });
  });
});
