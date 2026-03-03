/**
 * @vitest-environment jsdom
 *
 * Integration tests for ScenarioGridCard component.
 *
 * Tests that the grid card displays scenario name, target name,
 * and iteration number when available.
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

  describe("when rendered with scenario name", () => {
    it("displays the scenario name as the card title", () => {
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
    it("displays the target name", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData()}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("card-target-name")).toHaveTextContent("Target: Prod Agent");
    });
  });

  describe("when target name is null", () => {
    it("does not display a target name", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData()}
          targetName={null}
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("card-target-name")).not.toBeInTheDocument();
    });
  });

  describe("when iteration is provided", () => {
    it("displays the iteration number", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData()}
          targetName={null}
          onClick={vi.fn()}
          iteration={3}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("card-iteration")).toHaveTextContent("Iteration 3");
    });
  });

  describe("when iteration is not provided", () => {
    it("does not display an iteration number", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData()}
          targetName={null}
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("card-iteration")).not.toBeInTheDocument();
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
    it("displays scenario name, target, iteration, and duration together", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({
            name: "Refund Flow",
            durationInMs: 1500,
          })}
          targetName="Staging Agent"
          onClick={vi.fn()}
          iteration={2}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Refund Flow")).toBeInTheDocument();
      expect(screen.getByTestId("card-target-name")).toHaveTextContent("Target: Staging Agent");
      expect(screen.getByTestId("card-iteration")).toHaveTextContent("Iteration 2");
      expect(screen.getByText("1.5s")).toBeInTheDocument();
    });
  });
});
