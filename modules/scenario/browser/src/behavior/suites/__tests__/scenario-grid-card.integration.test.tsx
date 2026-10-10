/**
 * @vitest-environment jsdom
 * @see specs/features/suites/grid-view-and-borderless-tables.feature
 *   Scenario: Grid card shows scenario name, target, and iteration
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenarioGridCard } from "../../../ui/elements/suite/runs/scenario-grid-card.tsx";
import { makeScenarioRunData } from "./run-history-fixtures.ts";

const prefetchMock = vi.hoisted(() => vi.fn());
vi.mock("../use-prefetch-run-state.ts", () => ({
  usePrefetchRunState: () => prefetchMock,
}));

describe("<ScenarioGridCard/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when rendered with scenario name only", () => {
    it("displays just the scenario name as the card title", () => {
      renderWithDesignSystem(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName={null}
          onClick={vi.fn()}
        />,
      );

      expect(screen.getByText("Login Flow")).toBeInTheDocument();
    });
  });

  describe("when rendered without scenario name", () => {
    it("falls back to scenarioId as title", () => {
      renderWithDesignSystem(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({
            name: null,
            scenarioId: "scen_abc",
          })}
          targetName={null}
          onClick={vi.fn()}
        />,
      );

      expect(screen.getByText("scen_abc")).toBeInTheDocument();
    });
  });

  describe("when target name is provided", () => {
    it("prefixes the title with target name", () => {
      renderWithDesignSystem(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
      );

      expect(screen.getByText("Prod Agent: Login Flow")).toBeInTheDocument();
    });
  });

  describe("when target name is null", () => {
    it("does not include target in the title", () => {
      renderWithDesignSystem(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName={null}
          onClick={vi.fn()}
        />,
      );

      expect(screen.getByText("Login Flow")).toBeInTheDocument();
      expect(screen.queryByText(/:/)).not.toBeInTheDocument();
    });
  });

  describe("when iteration is provided", () => {
    it("appends iteration number to the title", () => {
      renderWithDesignSystem(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName={null}
          onClick={vi.fn()}
          iteration={3}
        />,
      );

      expect(screen.getByText("Login Flow (#3)")).toBeInTheDocument();
    });
  });

  describe("when iteration is not provided", () => {
    it("does not append iteration to the title", () => {
      renderWithDesignSystem(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName={null}
          onClick={vi.fn()}
        />,
      );

      expect(screen.queryByText(/\(#/)).not.toBeInTheDocument();
    });
  });

  describe("when clicked", () => {
    it("calls the onClick handler", async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      renderWithDesignSystem(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName={null}
          onClick={onClick}
        />,
      );

      await user.click(screen.getByLabelText(/View details for Login Flow/));
      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  describe("when rendered with all data", () => {
    /** @scenario "Grid card shows scenario name, target, and iteration" */
    it("displays title with target prefix, scenario, and iteration", () => {
      renderWithDesignSystem(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Refund Flow" })}
          targetName="Staging Agent"
          onClick={vi.fn()}
          iteration={2}
        />,
      );

      expect(screen.getByText("Staging Agent: Refund Flow (#2)")).toBeInTheDocument();
    });
  });

  describe("when the user hovers the card", () => {
    /** @scenario "Hovering a run pre-loads its details" */
    it("prefetches the run state for the hovered run", async () => {
      prefetchMock.mockClear();
      const user = userEvent.setup();
      renderWithDesignSystem(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({
            name: "Login Flow",
            scenarioRunId: "run_hover",
          })}
          targetName={null}
          onClick={vi.fn()}
          onPrefetch={() => prefetchMock("run_hover")}
        />,
      );

      await user.hover(screen.getByRole("button", { name: "View details for Login Flow" }));

      expect(prefetchMock).toHaveBeenCalledWith("run_hover");
    });
  });
});
