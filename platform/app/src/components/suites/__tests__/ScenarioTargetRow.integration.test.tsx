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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { ScenarioTargetRow } from "../ScenarioTargetRow";
import { makeScenarioRunData } from "./test-helpers";

const prefetchMock = vi.hoisted(() => vi.fn());
vi.mock("../usePrefetchRunState", () => ({
  usePrefetchRunState: () => prefetchMock,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/**
 * The coloured dot that sits immediately before a row's status label — the
 * first thing in the status group a reader's eye lands on.
 */
function statusIndicator(statusLabel: string): HTMLElement {
  const group = screen.getByText(statusLabel).parentElement;
  const indicator = group?.firstElementChild;
  if (!(indicator instanceof HTMLElement)) {
    throw new Error(`No status indicator found beside "${statusLabel}"`);
  }
  return indicator;
}

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

    /** @scenario "List view row displays passed status with criteria count" */
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

      expect(screen.getByText("Angry refund request")).toBeInTheDocument();
      expect(screen.queryByText(/:/)).not.toBeInTheDocument();
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

      expect(screen.getByText("Angry refund request (#1)")).toBeInTheDocument();
    });
  });

  describe("given a failed scenario run (ERROR status)", () => {
    /** @scenario "List view row displays failed status with criteria count" */
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

  describe("when the user hovers a row", () => {
    /** @scenario "Hovering a run pre-loads its details" */
    it("prefetches the run state for the hovered run", async () => {
      prefetchMock.mockClear();
      const user = userEvent.setup();
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ scenarioRunId: "run_hover" })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      await user.hover(
        screen.getByLabelText(
          "View details for Prod Agent: Angry refund request",
        ),
      );

      expect(prefetchMock).toHaveBeenCalledWith("run_hover");
    });
  });

  describe("given a run whose status is terminal", () => {
    /** @scenario List row shows colored status circle instead of icon */
    it("marks a passed run with a green dot rather than a checkmark icon", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.SUCCESS,
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const indicator = statusIndicator("Passed (1/1)");
      expect(indicator.tagName).toBe("DIV");
      expect(indicator.querySelector("svg")).toBeNull();
      expect(getComputedStyle(indicator).background).toContain("green-500");
    });

    /** @scenario List row shows status label with latency and cost */
    it("shows a passed run's label in green next to its latency and cost", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.SUCCESS,
            results: null,
            durationInMs: 1200,
            totalCost: 0.003,
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const label = screen.getByText("Passed");
      expect(getComputedStyle(label).color).toContain("green");
      expect(getComputedStyle(label).fontWeight).toContain("semibold");
      expect(screen.getByText("1.2s")).toBeInTheDocument();
      expect(screen.getByText("$0.003000")).toBeInTheDocument();
    });

    /** @scenario Failed list row shows red styling */
    it("shows a failed run's dot and label in red next to its latency", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.FAILED,
            results: null,
            durationInMs: 5400,
            totalCost: null,
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(getComputedStyle(statusIndicator("Failed")).background).toContain(
        "red-500",
      );
      const label = screen.getByText("Failed");
      expect(getComputedStyle(label).color).toContain("red");
      expect(getComputedStyle(label).fontWeight).toContain("semibold");
      expect(screen.getByText("5.4s")).toBeInTheDocument();
    });
  });

  describe("given a run recorded before cost and duration were captured", () => {
    /** @scenario List row without metrics shows only status label */
    it("shows the status label with no latency or cost beside it", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.SUCCESS,
            results: null,
            durationInMs: 0,
            totalCost: null,
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Passed")).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("$");
      expect(screen.queryByText(/\ds$|ms$/)).not.toBeInTheDocument();
    });
  });

  describe("when the user hovers a run's metrics", () => {
    /** @scenario List row tooltip breaks cost and latency down by role */
    it("breaks the cost and latency down by the roles that produced them", async () => {
      const user = userEvent.setup();
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.SUCCESS,
            results: null,
            durationInMs: 4500,
            totalCost: 0.024,
            roleCosts: {
              agent: [0.012, 0.006],
              judge: [0.004],
              user_simulator: [0.002],
            },
            roleLatencies: {
              agent: [2000, 1000],
              judge: [800],
              user_simulator: [700],
            },
          })}
          targetName="Prod Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      await user.hover(screen.getByText("4.5s"));

      await waitFor(() =>
        expect(screen.getByText("Duration")).toBeInTheDocument(),
      );

      // Totals for the whole run…
      expect(
        within(screen.getByText("Duration").parentElement!).getByText("4.5s"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByText("Total Cost").parentElement!).getByText(
          "$0.0240",
        ),
      ).toBeInTheDocument();

      // …then one latency and one cost line per contributing role.
      for (const role of ["agent", "judge", "user_simulator"]) {
        const lines = screen.getAllByText(role);
        expect(lines).toHaveLength(2);
      }
      // agent: mean of 2000 and 1000, then the sum of its two costs.
      const [agentLatencyRow, agentCostRow] = screen.getAllByText("agent");
      expect(
        within(agentLatencyRow!.parentElement!).getByText("1.5s"),
      ).toBeInTheDocument();
      expect(
        within(agentCostRow!.parentElement!).getByText("$0.0180"),
      ).toBeInTheDocument();
    });
  });
});
