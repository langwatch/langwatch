/**
 * The verified server-side fallback for a navigate id the conversation never
 * cached a link for. Prod wires this as the relay's `resolveResourceUrl`, but
 * the relay tests inject a stub for it — so this is where its real contract is
 * pinned: the `scenariorun_` prefix gate, the tenancy-scoped lookup through
 * the app's own services, null-on-miss (unknown run OR unresolvable project),
 * and the fact that the address is PLATFORM-computed, never agent-authored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({ env: { BASE_HOST: "https://app.langwatch.ai" } }));

const { getScenarioRunData, getProjectById } = vi.hoisted(() => ({
  getScenarioRunData: vi.fn(),
  getProjectById: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    simulations: { runs: { getScenarioRunData } },
    projects: { getById: getProjectById },
  }),
}));

import { resolveNavigateFallbackUrl } from "../langyNavigateFallback";

const RUN_ID = "scenariorun_0002Gu9QAAAABBBBCCCCDDDDEEE";
const DRAWER_URL =
  "https://app.langwatch.ai/acme/simulations?drawer.open=scenarioRunDetail" +
  `&drawer.scenarioRunId=${RUN_ID}`;

beforeEach(() => {
  getScenarioRunData.mockReset();
  getProjectById.mockReset();
});

describe("resolveNavigateFallbackUrl", () => {
  describe("given an id whose prefix names no resolvable resource", () => {
    it("returns null for a non-scenario-run id WITHOUT touching any service", async () => {
      // The prefix gate is the whole allow-list: an id the table doesn't know
      // is never a target the fallback will invent, and it must short-circuit
      // before any tenancy-scoped lookup runs.
      expect(
        await resolveNavigateFallbackUrl({
          projectId: "proj_1",
          resourceId: "trace_0002Gu9QAAAABBBB",
        }),
      ).toBeNull();
      expect(getScenarioRunData).not.toHaveBeenCalled();
      expect(getProjectById).not.toHaveBeenCalled();
    });
  });

  describe("given a scenario-run id the project can see", () => {
    it("looks the run up with the project's own access and returns the platform-computed drawer url", async () => {
      getScenarioRunData.mockResolvedValue({ scenarioRunId: RUN_ID });
      getProjectById.mockResolvedValue({ id: "proj_1", slug: "acme" });

      expect(
        await resolveNavigateFallbackUrl({
          projectId: "proj_1",
          resourceId: RUN_ID,
        }),
      ).toBe(DRAWER_URL);
      // Tenancy-scoped: the lookup is keyed by BOTH the project and the run,
      // never the run alone.
      expect(getScenarioRunData).toHaveBeenCalledWith({
        projectId: "proj_1",
        scenarioRunId: RUN_ID,
      });
    });
  });

  describe("given the run does not resolve in this project", () => {
    it("returns null when the run is not found, and never asks for the project", async () => {
      getScenarioRunData.mockResolvedValue(null);

      expect(
        await resolveNavigateFallbackUrl({
          projectId: "proj_1",
          resourceId: RUN_ID,
        }),
      ).toBeNull();
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it("returns null (never throws) when the tenancy-scoped lookup errors", async () => {
      getScenarioRunData.mockRejectedValue(new Error("clickhouse down"));

      await expect(
        resolveNavigateFallbackUrl({ projectId: "proj_1", resourceId: RUN_ID }),
      ).resolves.toBeNull();
    });
  });

  describe("given the run resolves but the project cannot build an address", () => {
    it("returns null when the project has no slug", async () => {
      getScenarioRunData.mockResolvedValue({ scenarioRunId: RUN_ID });
      getProjectById.mockResolvedValue({ id: "proj_1", slug: undefined });

      expect(
        await resolveNavigateFallbackUrl({
          projectId: "proj_1",
          resourceId: RUN_ID,
        }),
      ).toBeNull();
    });
  });
});
