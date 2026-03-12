/**
 * @see specs/features/suites/rename-suites-to-runs.feature - Route title scenarios
 */
import { describe, expect, it } from "vitest";
import { projectRoutes } from "../routes";

describe("projectRoutes", () => {
  describe("when the suites route configuration is read", () => {
    it("has title 'Run Plans'", () => {
      expect(projectRoutes.suites.title).toBe("Run Plans");
    });
  });

  describe("when the simulation runs route configuration is read", () => {
    it("has title 'Run History'", () => {
      expect(projectRoutes.simulation_runs.title).toBe("Run History");
    });
  });
});
