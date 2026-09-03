/**
 * @vitest-environment jsdom
 *
 * A project that reads Agent Testing is sent there from every simulations
 * address, so a saved link and a link an older SDK printed both land on the
 * page the project uses. With the flag off the v1 pages open as they did.
 *
 * The router and org/project scope are host-backed now (ScenarioHostPort,
 * ADR-004) rather than `~/utils/compat/next-router` /
 * `~/hooks/useOrganizationTeamProject` mocks.
 *
 * @see specs/features/agent-testing/page-structure.feature
 * @see specs/suites/new-simulations-callout.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioHostPort, ScenarioHostProvider } from "../../../model/scenario-host";

const state = vi.hoisted(() => ({
  flagEnabled: false,
  flagLoading: false,
  params: {} as Record<string, string | string[] | undefined>,
  query: {} as Record<string, string | undefined>,
  replace: vi.fn(),
}));

vi.mock("../../../behavior/use-feature-flag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled: flag === "release_ui_agent_testing_v2_enabled" ? state.flagEnabled : false,
    isLoading: state.flagLoading,
  }),
}));

// The v1 page itself is not under test: whether it renders at all is.
vi.mock("../../../ui/sections/suites/simulations-page", () => ({
  default: () => <div>v1 simulations page</div>,
}));

function TestScenarioHost({ children }: { children: React.ReactNode }) {
  const host = new (class extends ScenarioHostPort {
    project() {
      return { id: "project-1", slug: "demo", name: "Demo" };
    }
    organization() {
      return { id: "organization-1" };
    }
    team() {
      return void 0;
    }
    organizationRole() {
      return void 0;
    }
    currentUser() {
      return void 0;
    }
    hasPermission() {
      return true;
    }
    isLoading() {
      return false;
    }
    route() {
      return {
        params: state.params,
        query: state.query,
        pathname: "/demo/simulations",
      };
    }
    setQuery() {
      // Not exercised here.
    }
    navigate(to: string) {
      state.replace(to);
    }
    succeeded() {
      // Nothing here reports a success.
    }
    failed() {
      // Nothing here reports a failure.
    }
  })();

  return <ScenarioHostProvider value={host}>{children}</ScenarioHostProvider>;
}

async function renderRoute() {
  const { default: SimulationsRoute } = await import("../simulations.screen");
  return render(
    <TestScenarioHost>
      <SimulationsRoute />
    </TestScenarioHost>,
  );
}

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

    describe("and the previous-screens preference is recorded", () => {
      beforeEach(() => {
        localStorage.setItem("langwatch:prefer-legacy-simulations:v1:project-1", "1");
      });

      afterEach(() => {
        localStorage.clear();
      });

      /** @scenario "The previous-screens preference disables the Agent Testing redirect" */
      it("renders the v1 page without redirecting", async () => {
        state.params = { project: "demo" };
        state.query = {};

        await renderRoute();

        expect(state.replace).not.toHaveBeenCalled();
        expect(screen.getByText("v1 simulations page")).toBeDefined();
      });
    });

    /** @scenario "A saved simulations address opens in Agent Testing when the flag is on" */
    it("sends a saved run plan address to the plan in Agent Testing, without showing the v1 page", async () => {
      state.params = {
        project: "demo",
        path: ["run-plans", "checkout", "batch_1"],
      };
      state.query = { period: "7d" };

      await renderRoute();

      expect(state.replace).toHaveBeenCalledWith(
        "/demo/agent-testing/results/checkout/batch_1?period=7d",
      );
      expect(screen.queryByText("v1 simulations page")).toBeNull();
    });

    it("sends the address the scenario library printed to the run in Agent Testing", async () => {
      state.params = { project: "demo", path: ["python-examples", "batch_1"] };
      state.query = {};

      await renderRoute();

      expect(state.replace).toHaveBeenCalledWith(
        "/demo/agent-testing/results/external:python-examples/batch_1",
      );
    });

    it("sends the run history to the results list", async () => {
      state.params = { project: "demo" };
      state.query = {};

      await renderRoute();

      expect(state.replace).toHaveBeenCalledWith("/demo/agent-testing/results");
      expect(screen.queryByText("v1 simulations page")).toBeNull();
    });

    it("shows nothing while the flag is still being read", async () => {
      state.flagEnabled = false;
      state.flagLoading = true;
      state.params = { project: "demo" };
      state.query = {};

      await renderRoute();

      expect(state.replace).not.toHaveBeenCalled();
      expect(screen.queryByText("v1 simulations page")).toBeNull();
    });
  });

  describe("given the Agent Testing release flag is off", () => {
    /** @scenario "A saved simulations address opens as it did when the flag is off" */
    it("renders the v1 page and sends the reader nowhere", async () => {
      state.params = { project: "demo", path: ["run-plans", "checkout"] };
      state.query = {};

      await renderRoute();

      expect(screen.getByText("v1 simulations page")).toBeInTheDocument();
      expect(state.replace).not.toHaveBeenCalled();
    });

    it("still follows the v1 redirect for a near-miss address", async () => {
      state.params = { project: "demo", path: ["scenarios", "scenario_1"] };
      state.query = {};

      await renderRoute();

      expect(state.replace).toHaveBeenCalledWith(
        "/demo/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=scenario_1",
      );
    });
  });
});
