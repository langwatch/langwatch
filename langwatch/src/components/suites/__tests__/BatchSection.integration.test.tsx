/**
 * @vitest-environment jsdom
 *
 * Integration tests for BatchSection component.
 *
 * Tests that batch sub-header renders with pass rate,
 * and that ScenarioRunContent receives batch scenario runs.
 * ScenarioRunContent and SummaryStatusIcon are mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchSection } from "../BatchSection";
import { makeBatchRun, makeScenarioRunData } from "./test-helpers";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

vi.mock("../SummaryStatusIcon", () => ({
  SummaryStatusIcon: () => <span data-testid="summary-status-icon" />,
}));

vi.mock("../ScenarioRunContent", () => ({
  ScenarioRunContent: ({
    scenarioRuns,
    viewMode,
  }: {
    scenarioRuns: Array<{ scenarioRunId: string }>;
    viewMode: string;
  }) => (
    <div data-testid="scenario-run-content" data-view-mode={viewMode}>
      {scenarioRuns.map((r) => (
        <span key={r.scenarioRunId} data-testid={`run-${r.scenarioRunId}`} />
      ))}
    </div>
  ),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<BatchSection/>", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when rendered with a batch", () => {
    it("renders the batch sub-header", () => {
      render(
        <BatchSection
          batch={makeBatchRun()}
          resolveTargetName={() => "Target"}
          onScenarioRunClick={vi.fn()}
          viewMode="grid"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("batch-sub-header")).toBeInTheDocument();
    });

    it("displays passed/failed status with scenario count", () => {
      const batch = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ scenarioRunId: "run_1", status: ScenarioRunStatus.SUCCESS }),
          makeScenarioRunData({ scenarioRunId: "run_2", status: ScenarioRunStatus.SUCCESS }),
        ],
      });

      render(
        <BatchSection
          batch={batch}
          resolveTargetName={() => "Target"}
          onScenarioRunClick={vi.fn()}
          viewMode="grid"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("2 ✓")).toBeInTheDocument();
      expect(screen.queryByText("100%")).not.toBeInTheDocument();
    });

    it("renders ScenarioRunContent with the batch scenario runs", () => {
      const batch = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ scenarioRunId: "run_a" }),
          makeScenarioRunData({ scenarioRunId: "run_b" }),
        ],
      });

      render(
        <BatchSection
          batch={batch}
          resolveTargetName={() => "Target"}
          onScenarioRunClick={vi.fn()}
          viewMode="list"
        />,
        { wrapper: Wrapper },
      );

      const content = screen.getByTestId("scenario-run-content");
      expect(content).toBeInTheDocument();
      expect(content).toHaveAttribute("data-view-mode", "list");
      expect(screen.getByTestId("run-run_a")).toBeInTheDocument();
      expect(screen.getByTestId("run-run_b")).toBeInTheDocument();
    });
  });
});
