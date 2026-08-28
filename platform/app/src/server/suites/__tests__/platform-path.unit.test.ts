/**
 * @vitest-environment node
 *
 * Which interface a suite link opens, per project.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: vi.fn() },
}));

import { featureFlagService } from "~/server/featureFlag";
import { suitePlatformPath } from "../platform-path";

const isEnabled = vi.mocked(featureFlagService.isEnabled);

const pathFor = (kind: "custom" | "folder") =>
  suitePlatformPath({
    projectId: "project_1",
    organizationId: "org_1",
    slug: "refunds",
    kind,
  });

describe("suitePlatformPath", () => {
  beforeEach(() => {
    isEnabled.mockReset();
  });

  describe("given the project reads Agent Testing", () => {
    beforeEach(() => {
      isEnabled.mockResolvedValue(true);
    });

    it("opens a run plan on its results page", async () => {
      await expect(pathFor("custom")).resolves.toBe(
        "/agent-testing/results/refunds",
      );
    });

    it("opens a test suite on its own page", async () => {
      await expect(pathFor("folder")).resolves.toBe(
        "/agent-testing/suites/refunds",
      );
    });

    it("names the project and the organization in the flag read", async () => {
      await pathFor("custom");

      expect(isEnabled).toHaveBeenCalledWith(
        "release_ui_agent_testing_v2_enabled",
        expect.objectContaining({
          projectId: "project_1",
          organizationId: "org_1",
        }),
      );
    });
  });

  describe("given the project reads the Simulations pages", () => {
    beforeEach(() => {
      isEnabled.mockResolvedValue(false);
    });

    it("opens a run plan on its simulations page", async () => {
      await expect(pathFor("custom")).resolves.toBe(
        "/simulations/run-plans/refunds",
      );
    });

    it("opens a test suite on the simulations index", async () => {
      await expect(pathFor("folder")).resolves.toBe("/simulations");
    });
  });

  describe("when the flag read fails", () => {
    it("answers the interface every project can open", async () => {
      isEnabled.mockRejectedValue(new Error("flag store unreachable"));

      await expect(pathFor("custom")).resolves.toBe(
        "/simulations/run-plans/refunds",
      );
    });
  });
});
