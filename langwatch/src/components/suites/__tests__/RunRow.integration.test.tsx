/**
 * @vitest-environment jsdom
 *
 * Integration tests for RunRow component.
 *
 * Tests the collapsible run row behavior: expand/collapse,
 * display of pass rate, timestamp, and scenario x target rows.
 *
 * @see specs/suites/suite-workflow.feature - "Run History List"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunRow } from "../RunRow";
import { makeScenarioRunData, makeBatchRun, makeSummary } from "./test-helpers";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<RunRow/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when collapsed", () => {
    it("displays pass rate percentage", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("does not display scenario x target rows", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.queryByText(/Angry refund request/),
      ).not.toBeInTheDocument();
    });
  });

  describe("when expanded", () => {
    it("displays scenario x target rows", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText(/Angry refund request/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Policy violation/),
      ).toBeInTheDocument();
    });

    it("displays target name in scenario x target format", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // The unicode multiplication sign is used between scenario and target
      expect(
        screen.getByText(/Angry refund request \u00d7 Prod Agent/),
      ).toBeInTheDocument();
    });

    it("displays duration for finished runs", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const durationElements = screen.getAllByText("2.3s");
      expect(durationElements.length).toBeGreaterThan(0);
    });
  });

  describe("when the header is clicked", () => {
    it("calls onToggle", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();

      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={onToggle}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const header = screen.getByRole("button", { name: /Run from/ });
      await user.click(header);
      expect(onToggle).toHaveBeenCalledOnce();
    });
  });

  describe("when a scenario x target row is clicked", () => {
    it("calls onScenarioRunClick with the scenario run data", async () => {
      const user = userEvent.setup();
      const onScenarioRunClick = vi.fn();
      const scenarioRun = makeScenarioRunData();

      render(
        <RunRow
          batchRun={makeBatchRun({ scenarioRuns: [scenarioRun] })}
          summary={makeSummary({ totalCount: 1, passedCount: 1 })}
          isExpanded={true}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={onScenarioRunClick}
        />,
        { wrapper: Wrapper },
      );

      const row = screen.getByLabelText(/View details for/);
      await user.click(row);
      expect(onScenarioRunClick).toHaveBeenCalledWith(scenarioRun);
    });
  });

  describe("when summary shows failures", () => {
    it("displays pass rate with failure indicator", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary({ passRate: 88, failedCount: 1 })}
          isExpanded={false}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("88%")).toBeInTheDocument();
    });
  });

  describe("when expectedJobCount is provided", () => {
    describe("when not all jobs are done", () => {
      it("displays progress indicator next to pass rate", () => {
        render(
          <RunRow
            batchRun={makeBatchRun()}
            summary={makeSummary({ totalCount: 2 })}
            isExpanded={false}
            onToggle={vi.fn()}
            targetName="Prod Agent"
            onScenarioRunClick={vi.fn()}
            expectedJobCount={6}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText("2 of 6")).toBeInTheDocument();
      });
    });

    describe("when all jobs are done", () => {
      it("does not display progress indicator", () => {
        render(
          <RunRow
            batchRun={makeBatchRun()}
            summary={makeSummary({ totalCount: 6 })}
            isExpanded={false}
            onToggle={vi.fn()}
            targetName="Prod Agent"
            onScenarioRunClick={vi.fn()}
            expectedJobCount={6}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.queryByText(/of 6/)).not.toBeInTheDocument();
      });
    });
  });

  describe("when expectedJobCount is not provided", () => {
    it("does not display progress indicator", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary({ totalCount: 2 })}
          isExpanded={false}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText(/of \d+/)).not.toBeInTheDocument();
    });
  });

  describe("when suiteName is provided (All Runs view)", () => {
    describe("when collapsed with multiple scenarios", () => {
      it("displays scenario names after suite name", () => {
        const batchRun = makeBatchRun({
          scenarioRuns: [
            makeScenarioRunData({ name: "Login Flow", scenarioRunId: "r1" }),
            makeScenarioRunData({ name: "Checkout Flow", scenarioRunId: "r2" }),
          ],
        });

        render(
          <RunRow
            batchRun={batchRun}
            summary={makeSummary()}
            isExpanded={false}
            onToggle={vi.fn()}
            targetName={null}
            onScenarioRunClick={vi.fn()}
            suiteName="My Suite"
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText("My Suite")).toBeInTheDocument();
        expect(screen.getByText("Checkout Flow, Login Flow")).toBeInTheDocument();
      });
    });

    describe("when collapsed with a single scenario", () => {
      it("displays the single scenario name", () => {
        const batchRun = makeBatchRun({
          scenarioRuns: [
            makeScenarioRunData({ name: "Login Flow", scenarioRunId: "r1" }),
          ],
        });

        render(
          <RunRow
            batchRun={batchRun}
            summary={makeSummary({ totalCount: 1, passedCount: 1 })}
            isExpanded={false}
            onToggle={vi.fn()}
            targetName={null}
            onScenarioRunClick={vi.fn()}
            suiteName="My Suite"
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText("Login Flow")).toBeInTheDocument();
      });
    });

    describe("when collapsed with more than 3 scenarios", () => {
      it("truncates with +N more", () => {
        const batchRun = makeBatchRun({
          scenarioRuns: [
            makeScenarioRunData({ name: "Alpha", scenarioRunId: "r1" }),
            makeScenarioRunData({ name: "Beta", scenarioRunId: "r2" }),
            makeScenarioRunData({ name: "Gamma", scenarioRunId: "r3" }),
            makeScenarioRunData({ name: "Delta", scenarioRunId: "r4" }),
            makeScenarioRunData({ name: "Epsilon", scenarioRunId: "r5" }),
          ],
        });

        render(
          <RunRow
            batchRun={batchRun}
            summary={makeSummary({ totalCount: 5, passedCount: 5 })}
            isExpanded={false}
            onToggle={vi.fn()}
            targetName={null}
            onScenarioRunClick={vi.fn()}
            suiteName="My Suite"
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText("Alpha, Beta, Delta +2 more")).toBeInTheDocument();
      });
    });
  });

  describe("when suiteName is not provided (Suite-specific view)", () => {
    it("does not display scenario names in header", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ name: "Login Flow", scenarioRunId: "r1" }),
          makeScenarioRunData({ name: "Checkout Flow", scenarioRunId: "r2" }),
        ],
      });

      render(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("Checkout Flow, Login Flow")).not.toBeInTheDocument();
    });
  });
});
