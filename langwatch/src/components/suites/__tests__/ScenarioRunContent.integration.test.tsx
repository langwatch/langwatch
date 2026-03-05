/**
 * @vitest-environment jsdom
 *
 * Integration tests for ScenarioRunContent component.
 *
 * Tests grid vs list rendering and click delegation.
 * ScenarioGridCard and ScenarioTargetRow are mocked to keep tests focused.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunContent } from "../ScenarioRunContent";
import { makeScenarioRunData } from "./test-helpers";

vi.mock("../ScenarioGridCard", () => ({
  ScenarioGridCard: ({
    scenarioRun,
    onClick,
  }: {
    scenarioRun: { scenarioRunId: string; name: string };
    onClick: () => void;
  }) => (
    <div data-testid={`grid-card-${scenarioRun.scenarioRunId}`} onClick={onClick}>
      {scenarioRun.name}
    </div>
  ),
}));

vi.mock("../ScenarioTargetRow", () => ({
  ScenarioTargetRow: ({
    scenarioRun,
    onClick,
  }: {
    scenarioRun: { scenarioRunId: string; name: string };
    onClick: () => void;
  }) => (
    <div data-testid={`list-row-${scenarioRun.scenarioRunId}`} onClick={onClick}>
      {scenarioRun.name}
    </div>
  ),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const defaultProps = {
  scenarioRuns: [
    makeScenarioRunData({ scenarioRunId: "run_1", name: "Scenario A" }),
    makeScenarioRunData({ scenarioRunId: "run_2", name: "Scenario B" }),
  ],
  resolveTargetName: () => "Target",
  onScenarioRunClick: vi.fn(),
  iterationMap: new Map<string, number>(),
};

describe("<ScenarioRunContent/>", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when viewMode is 'grid'", () => {
    it("renders a grid container", () => {
      render(<ScenarioRunContent {...defaultProps} viewMode="grid" />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("scenario-grid")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-list")).not.toBeInTheDocument();
    });

    it("renders grid cards for each scenario run", () => {
      render(<ScenarioRunContent {...defaultProps} viewMode="grid" />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("grid-card-run_1")).toBeInTheDocument();
      expect(screen.getByTestId("grid-card-run_2")).toBeInTheDocument();
    });
  });

  describe("when viewMode is 'list'", () => {
    it("renders a list container", () => {
      render(<ScenarioRunContent {...defaultProps} viewMode="list" />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("scenario-list")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-grid")).not.toBeInTheDocument();
    });

    it("renders list rows for each scenario run", () => {
      render(<ScenarioRunContent {...defaultProps} viewMode="list" />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("list-row-run_1")).toBeInTheDocument();
      expect(screen.getByTestId("list-row-run_2")).toBeInTheDocument();
    });
  });

  describe("when a card is clicked", () => {
    it("calls onScenarioRunClick with the scenario run", async () => {
      const user = userEvent.setup();
      const onScenarioRunClick = vi.fn();

      render(
        <ScenarioRunContent
          {...defaultProps}
          viewMode="grid"
          onScenarioRunClick={onScenarioRunClick}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("grid-card-run_1"));

      expect(onScenarioRunClick).toHaveBeenCalledTimes(1);
      expect(onScenarioRunClick).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioRunId: "run_1" }),
      );
    });
  });

  describe("when a list row is clicked", () => {
    it("calls onScenarioRunClick with the scenario run", async () => {
      const user = userEvent.setup();
      const onScenarioRunClick = vi.fn();

      render(
        <ScenarioRunContent
          {...defaultProps}
          viewMode="list"
          onScenarioRunClick={onScenarioRunClick}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("list-row-run_2"));

      expect(onScenarioRunClick).toHaveBeenCalledTimes(1);
      expect(onScenarioRunClick).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioRunId: "run_2" }),
      );
    });
  });
});
