/**
 * @vitest-environment jsdom
 *
 * A project that reads Agent Testing is sent there from every simulations
 * address, so a saved link and a link an older SDK printed both land on the
 * page the project uses. With the flag off the v1 pages open as they did.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  flagEnabled: false,
  flagLoading: false,
  query: {} as Record<string, string | string[] | undefined>,
  replace: vi.fn(),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled:
      flag === "release_ui_agent_testing_v2_enabled"
        ? state.flagEnabled
        : false,
    isLoading: state.flagLoading,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "demo" },
    organization: { id: "organization-1" },
    isLoading: false,
    hasPermission: () => true,
    hasAnyPermission: () => true,
    isPublicRoute: false,
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: state.query,
    pathname: "/[project]/simulations/[[...path]]",
    asPath: "/demo/simulations",
    push: vi.fn(),
    replace: state.replace,
    isReady: true,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard:
    () =>
    <P extends object>(Component: React.ComponentType<P>) =>
      Component,
}));

// The v1 page itself is not under test: whether it renders at all is.
vi.mock("~/components/suites/SimulationsPage", () => ({
  default: () => <div>v1 simulations page</div>,
}));

import SimulationsRoute from "../[project]/simulations/[[...path]]";

describe("the simulations address", () => {
  beforeEach(() => {
    state.flagEnabled = false;
    state.flagLoading = false;
    state.replace.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the Agent Testing release flag is on", () => {
    beforeEach(() => {
      state.flagEnabled = true;
    });

    /** @scenario "A saved simulations address opens in Agent Testing when the flag is on" */
    it("sends a saved run plan address to the plan in Agent Testing, without showing the v1 page", () => {
      state.query = {
        project: "demo",
        path: ["run-plans", "checkout", "batch_1"],
        period: "7d",
      };

      render(<SimulationsRoute />);

      expect(state.replace).toHaveBeenCalledWith(
        "/demo/agent-testing/results/checkout/batch_1?period=7d",
      );
      expect(screen.queryByText("v1 simulations page")).toBeNull();
    });

    it("sends the address the scenario library printed to the run in Agent Testing", () => {
      state.query = { project: "demo", path: ["python-examples", "batch_1"] };

      render(<SimulationsRoute />);

      expect(state.replace).toHaveBeenCalledWith(
        "/demo/agent-testing/results/external:python-examples/batch_1",
      );
    });

    it("sends the run history to the results list", () => {
      state.query = { project: "demo" };

      render(<SimulationsRoute />);

      expect(state.replace).toHaveBeenCalledWith("/demo/agent-testing/results");
      expect(screen.queryByText("v1 simulations page")).toBeNull();
    });

    it("shows nothing while the flag is still being read", () => {
      state.flagEnabled = false;
      state.flagLoading = true;
      state.query = { project: "demo" };

      render(<SimulationsRoute />);

      expect(state.replace).not.toHaveBeenCalled();
      expect(screen.queryByText("v1 simulations page")).toBeNull();
    });
  });

  describe("given the Agent Testing release flag is off", () => {
    /** @scenario "A saved simulations address opens as it did when the flag is off" */
    it("renders the v1 page and sends the reader nowhere", () => {
      state.query = { project: "demo", path: ["run-plans", "checkout"] };

      render(<SimulationsRoute />);

      expect(screen.getByText("v1 simulations page")).toBeInTheDocument();
      expect(state.replace).not.toHaveBeenCalled();
    });

    it("still follows the v1 redirect for a near-miss address", () => {
      state.query = { project: "demo", path: ["scenarios", "scenario_1"] };

      render(<SimulationsRoute />);

      expect(state.replace).toHaveBeenCalledWith(
        "/demo/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=scenario_1",
      );
    });
  });
});
