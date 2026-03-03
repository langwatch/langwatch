/**
 * @vitest-environment jsdom
 *
 * Integration tests for ScenarioGridCard component.
 *
 * Tests that the grid card displays a "Target: Scenario (#N)" title
 * using the same format as ScenarioTargetRow.
 *
 * @see specs/features/suites/grid-view-and-borderless-tables.feature
 *   Scenario: Grid card shows scenario name, target, and iteration
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioGridCard } from "../ScenarioGridCard";
import { makeScenarioRunData } from "./test-helpers";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ScenarioGridCard/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when rendered with scenario name only", () => {
    it("displays just the scenario name as the card title", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName={null}
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Login Flow")).toBeInTheDocument();
    });
  });

  describe("when rendered without scenario name", () => {
    it("falls back to scenarioId as title", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: null, scenarioId: "scen_abc" })}
          targetName={null}
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("scen_abc")).toBeInTheDocument();
    });
  });

  describe("when target name is provided", () => {
    it("prefixes the title with target name", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Prod Agent: Login Flow")).toBeInTheDocument();
    });
  });

  describe("when target name is null", () => {
    it("does not include target in the title", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName={null}
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Login Flow")).toBeInTheDocument();
      expect(screen.queryByText(/:/)).not.toBeInTheDocument();
    });
  });

  describe("when iteration is provided", () => {
    it("appends iteration number to the title", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName={null}
          onClick={vi.fn()}
          iteration={3}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Login Flow (#3)")).toBeInTheDocument();
    });
  });

  describe("when iteration is not provided", () => {
    it("does not append iteration to the title", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName={null}
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText(/\(#/)).not.toBeInTheDocument();
    });
  });

  describe("when clicked", () => {
    it("calls the onClick handler", async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Login Flow" })}
          targetName={null}
          onClick={onClick}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByLabelText(/View details for Login Flow/));
      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  describe("when rendered with all data", () => {
    it("displays title with target prefix, scenario, and iteration", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ name: "Refund Flow" })}
          targetName="Staging Agent"
          onClick={vi.fn()}
          iteration={2}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("Staging Agent: Refund Flow (#2)"),
      ).toBeInTheDocument();
    });
  });
});
