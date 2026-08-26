/**
 * @vitest-environment jsdom
 *
 * Quick Search offers the Agent Testing destination behind the same release
 * flag as the main menu, and drops the Simulations entries it replaces.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ agentTestingEnabled: false }));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "demo" },
    organization: { id: "organization-1" },
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled:
      flag === "release_ui_agent_testing_v2_enabled"
        ? state.agentTestingEnabled
        : false,
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: false }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: "/[project]" }),
}));

import { useFilteredCommands } from "../hooks/useFilteredCommands";

const navigationIdsFor = (query: string): string[] => {
  const { result } = renderHook(() =>
    useFilteredCommands(query, true, "project-1", false),
  );
  return result.current.navigation.map((command) => command.id);
};

describe("Quick Search and the Agent Testing release flag", () => {
  beforeEach(() => {
    state.agentTestingEnabled = false;
    localStorage.clear();
  });

  describe("given the flag is on", () => {
    beforeEach(() => {
      state.agentTestingEnabled = true;
    });

    /** @scenario "Quick Search offers Agent Testing while the flag is on" */
    it("offers the Agent Testing page", () => {
      expect(navigationIdsFor("agent testing")).toContain("nav-agent-testing");
    });

    /** @scenario "Quick Search offers Agent Testing while the flag is on" */
    it("offers neither Simulations nor Scenarios", () => {
      const ids = navigationIdsFor("simulation");

      expect(ids).not.toContain("nav-simulations");
      expect(ids).not.toContain("nav-scenarios");
    });
  });

  describe("given the flag is off", () => {
    /** @scenario "Quick Search keeps the Simulations entries while the flag is off" */
    it("offers Simulations", () => {
      expect(navigationIdsFor("simulations")).toContain("nav-simulations");
    });

    /** @scenario "Quick Search keeps the Simulations entries while the flag is off" */
    it("offers no Agent Testing page", () => {
      expect(navigationIdsFor("agent testing")).not.toContain(
        "nav-agent-testing",
      );
    });
  });
});
