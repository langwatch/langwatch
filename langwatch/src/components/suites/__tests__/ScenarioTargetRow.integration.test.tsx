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
import { ScenarioRunStatus, Verdict } from "~/server/scenarios/scenario-event.enums";
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
    it("displays target-prefixed scenario name", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData()}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("Prod Agent: Angry refund request"),
      ).toBeInTheDocument();
    });

    it("displays 'passed' with criteria count for SUCCESS status", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData()}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Passed (1/1)")).toBeInTheDocument();
      expect(screen.queryByText("100%")).not.toBeInTheDocument();
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
        screen.queryByText(/:/),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a scenario run with iteration", () => {
    it("appends iteration number to the display name", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData()}
          targetName="Prod Agent"
          onClick={vi.fn()}
          iteration={3}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("Prod Agent: Angry refund request (#3)"),
      ).toBeInTheDocument();
    });
  });

  describe("given a scenario run without target but with iteration", () => {
    it("appends iteration to scenario name only", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData()}
          targetName={null}
          onClick={vi.fn()}
          iteration={1}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("Angry refund request (#1)"),
      ).toBeInTheDocument();
    });
  });

  describe("given a failed scenario run (ERROR status)", () => {
    it("displays 'failed' with criteria count for ERROR status", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.ERROR,
            results: {
              verdict: Verdict.FAILURE,
              reasoning: "Error occurred",
              metCriteria: ["c1"],
              unmetCriteria: ["c2", "c3"],
            },
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Failed (1/3)")).toBeInTheDocument();
    });
  });

  describe("given a failed scenario run (FAILED status)", () => {
    it("displays 'failed' with criteria count for FAILED status", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.FAILED,
            results: {
              verdict: Verdict.FAILURE,
              reasoning: "Criteria not met",
              metCriteria: ["c1", "c2"],
              unmetCriteria: ["c3"],
            },
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Failed (2/3)")).toBeInTheDocument();
    });
  });

  describe("given a successful run with no criteria results", () => {
    it("displays 'passed' without count", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.SUCCESS,
            results: null,
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Passed")).toBeInTheDocument();
    });
  });

  describe("given an in-progress scenario run", () => {
    it("displays 'running' label instead of pass rate", () => {
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

      expect(screen.getByText("Running")).toBeInTheDocument();
      expect(screen.queryByText(/Passed/)).not.toBeInTheDocument();
    });
  });

  describe("given a stalled scenario run", () => {
    it("displays 'stalled' label", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.STALLED,
            durationInMs: 0,
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Stalled")).toBeInTheDocument();
    });
  });

  describe("given a cancelled scenario run", () => {
    it("displays 'cancelled' label", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.CANCELLED,
            durationInMs: 0,
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Cancelled")).toBeInTheDocument();
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
        "View details for Prod Agent: Angry refund request",
      );
      await user.click(row);
      expect(onClick).toHaveBeenCalledOnce();
    });
  });
});
