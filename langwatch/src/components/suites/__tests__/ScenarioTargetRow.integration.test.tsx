/**
 * @vitest-environment jsdom
 *
 * Integration tests for ScenarioTargetRow component.
 *
 * Tests the display of scenario x target pairs inside expanded run rows:
 * status icons, display name formatting, duration, and click handling.
 *
 * @see specs/suites/suite-workflow.feature - "Expand run to see scenario x target breakdown"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import { ScenarioTargetRow } from "../ScenarioTargetRow";
import { makeScenarioRunData } from "./test-helpers";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ScenarioTargetRow/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given a successful scenario run with a target", () => {
    it("displays scenario name with target in multiplication format", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData()}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("Angry refund request \u00d7 Prod Agent"),
      ).toBeInTheDocument();
    });

    it("displays 100% pass rate for SUCCESS status", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData()}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("displays duration formatted as seconds", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ durationInMs: 2300 })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("2.3s")).toBeInTheDocument();
    });
  });

  describe("given a scenario run without a target name", () => {
    it("displays only the scenario name", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData()}
          targetName={null}
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("Angry refund request"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/\u00d7/),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a failed scenario run (ERROR status)", () => {
    it("displays 0% for ERROR status", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.ERROR,
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("0%")).toBeInTheDocument();
    });
  });

  describe("given a failed scenario run (FAILED status)", () => {
    it("displays 0% for FAILED status", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.FAILED,
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("0%")).toBeInTheDocument();
    });
  });

  describe("given an in-progress scenario run", () => {
    it("displays In progress text instead of pass rate", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.IN_PROGRESS,
            durationInMs: 0,
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("In progress")).toBeInTheDocument();
      expect(screen.queryByText("100%")).not.toBeInTheDocument();
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
    });
  });

  describe("given a duration less than 1 second", () => {
    it("displays duration in milliseconds", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ durationInMs: 450 })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("450ms")).toBeInTheDocument();
    });
  });

  describe("when the row is clicked", () => {
    it("calls onClick callback", async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData()}
          targetName="Prod Agent"
          onClick={onClick}
        />,
        { wrapper: Wrapper },
      );

      const row = screen.getByLabelText(
        "View details for Angry refund request \u00d7 Prod Agent",
      );
      await user.click(row);
      expect(onClick).toHaveBeenCalledOnce();
    });
  });
});
