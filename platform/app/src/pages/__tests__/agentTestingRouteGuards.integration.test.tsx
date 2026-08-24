/**
 * @vitest-environment jsdom
 *
 * The Agent Testing address is behind the release flag AND behind permission
 * to read test cases. The flag decides whether the address exists at all, and
 * it grants nothing on its own.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  flagEnabled: true,
  permitted: true,
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled:
      flag === "release_ui_agent_testing_v2_enabled"
        ? state.flagEnabled
        : false,
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "demo" },
    organization: { id: "organization-1" },
    isLoading: false,
    hasPermission: () => state.permitted,
    hasAnyPermission: () => state.permitted,
    isPublicRoute: false,
  }),
}));

vi.mock("~/components/NotFoundScene", () => ({
  NotFoundScene: () => <div>this page does not exist</div>,
}));

vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>loading</div>,
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// The page's own boundaries. The page shell is under test, not the reads it
// makes or the drawers it warms up.
vi.mock("~/components/scenarios/ScenarioCreateModal", () => ({
  ScenarioCreateModal: () => null,
}));

vi.mock("~/hooks/usePreloadDrawer", () => ({
  usePreloadDrawer: () => undefined,
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), setFlowCallbacks: vi.fn() }),
}));

vi.mock("~/hooks/useSimulationUpdateListener", () => ({
  useSimulationUpdateListener: () => ({ isConnected: true }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      suites: { getSummaries: { invalidate: vi.fn() } },
      scenarios: { getExternalSetSummaries: { invalidate: vi.fn() } },
    }),
  },
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    isReady: true,
    asPath: "/demo/agent-testing",
    pathname: "/[project]/agent-testing/[[...path]]",
    query: { project: "demo" },
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

import AgentTestingRoute from "../[project]/agent-testing/[[...path]]";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("the Agent Testing address", () => {
  beforeEach(() => {
    state.flagEnabled = true;
    state.permitted = true;
  });

  afterEach(cleanup);

  describe("given the release flag is off", () => {
    beforeEach(() => {
      state.flagEnabled = false;
    });

    /** @scenario "With the flag off the Agent Testing route is not reachable" */
    it("does not show the page, and shows a page a person can read", () => {
      render(<AgentTestingRoute />, { wrapper: Wrapper });

      expect(
        screen.queryByRole("heading", { name: "Agent Testing" }),
      ).toBeNull();
      expect(screen.getByText("this page does not exist")).toBeInTheDocument();
    });
  });

  describe("given the release flag is on", () => {
    /** @scenario "With the flag on the Agent Testing page opens" */
    it("shows the page with its header and its tabs", () => {
      render(<AgentTestingRoute />, { wrapper: Wrapper });

      expect(
        screen.getByRole("heading", { name: "Agent Testing" }),
      ).toBeInTheDocument();
      const tabNames = screen.getAllByRole("tab").map((tab) => tab.textContent);
      expect(tabNames).toEqual(["Test cases", "Results"]);
    });

    describe("and the person may not read test cases", () => {
      beforeEach(() => {
        state.permitted = false;
      });

      /** @scenario "A person without permission to read test cases cannot open the page" */
      it("refuses the page, so the flag alone grants nothing", () => {
        render(<AgentTestingRoute />, { wrapper: Wrapper });

        expect(
          screen.queryByRole("heading", { name: "Agent Testing" }),
        ).toBeNull();
        expect(screen.getByText("Access Restricted")).toBeInTheDocument();
      });
    });
  });
});
