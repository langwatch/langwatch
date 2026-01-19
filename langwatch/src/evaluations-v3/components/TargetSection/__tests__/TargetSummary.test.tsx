/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { TargetAggregate } from "../../../utils/computeAggregates";
import { TargetSummary } from "../TargetSummary";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const createAggregate = (
  overrides: Partial<TargetAggregate> = {},
): TargetAggregate => ({
  targetId: "target-1",
  completedRows: 0,
  totalRows: 10,
  errorRows: 0,
  evaluators: [],
  overallPassRate: null,
  overallAverageScore: null,
  averageCost: null,
  totalCost: null,
  averageLatency: null,
  totalDuration: null,
  latencyStats: null,
  costStats: null,
  ...overrides,
});

describe("TargetSummary", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when no results and not running", () => {
    const aggregates = createAggregate({ completedRows: 0 });
    const { container } = render(<TargetSummary aggregates={aggregates} />, {
      wrapper: Wrapper,
    });
    // The wrapper is there but the component itself returns null
    expect(
      container.querySelector('[data-testid="target-summary"]'),
    ).toBeNull();
  });

  it("renders when there are completed rows", () => {
    const aggregates = createAggregate({ completedRows: 5 });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });
    expect(screen.getByTestId("target-summary")).toBeInTheDocument();
  });

  it("renders progress when running", () => {
    const aggregates = createAggregate({ completedRows: 3, totalRows: 10 });
    render(<TargetSummary aggregates={aggregates} isRunning />, {
      wrapper: Wrapper,
    });
    // May appear in both inline and popover content
    expect(screen.getAllByText("3/10").length).toBeGreaterThanOrEqual(1);
  });

  it("displays pass rate with circle when >= 50%", () => {
    const aggregates = createAggregate({
      completedRows: 10,
      overallPassRate: 75,
    });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });
    // May appear in both inline and popover content
    expect(screen.getAllByText("75%").length).toBeGreaterThanOrEqual(1);
  });

  it("displays pass rate with circle when < 50%", () => {
    const aggregates = createAggregate({
      completedRows: 10,
      overallPassRate: 30,
    });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });
    // May appear in both inline and popover content
    expect(screen.getAllByText("30%").length).toBeGreaterThanOrEqual(1);
  });

  it("displays average score", () => {
    const aggregates = createAggregate({
      completedRows: 5,
      overallAverageScore: 0.75,
    });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });
    // May appear in both inline and popover content
    expect(screen.getAllByText("0.75").length).toBeGreaterThanOrEqual(1);
  });

  it("displays average latency", () => {
    const aggregates = createAggregate({
      completedRows: 5,
      averageLatency: 1500,
    });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });
    // May appear in both inline and popover content
    expect(screen.getAllByText("1.5s").length).toBeGreaterThanOrEqual(1);
  });

  it("shows progress indicator when running", () => {
    const aggregates = createAggregate({
      completedRows: 5,
      totalRows: 10,
      averageLatency: 1500,
    });
    render(<TargetSummary aggregates={aggregates} isRunning />, {
      wrapper: Wrapper,
    });
    // When running, the progress indicator should be visible
    expect(screen.getAllByText("5/10").length).toBeGreaterThanOrEqual(1);
  });

  it("displays error count when there are errors", () => {
    const aggregates = createAggregate({
      completedRows: 10,
      errorRows: 3,
    });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });
    // May appear in both inline and popover content
    expect(screen.getAllByText("3 errors").length).toBeGreaterThanOrEqual(1);
  });

  it("renders with full aggregates including evaluator data", () => {
    // This test validates that the component renders correctly with full data
    // Tooltip content may also render in the DOM, so we use getAllByText
    const aggregates = createAggregate({
      completedRows: 8,
      totalRows: 10,
      errorRows: 1,
      overallPassRate: 75,
      overallAverageScore: 0.8,
      averageCost: 0.001,
      totalCost: 0.008,
      averageLatency: 1200,
      evaluators: [
        {
          evaluatorId: "eval-1",
          evaluatorName: "Exact Match",
          total: 8,
          passed: 6,
          failed: 1,
          errors: 1,
          passRate: 75,
          averageScore: 0.8,
        },
      ],
    });

    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });

    // Should show pass rate and score - may appear in both inline and tooltip
    expect(screen.getAllByText("75%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("0.80").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1.2s").length).toBeGreaterThanOrEqual(1);
  });

  it("shows combined metrics: pass rate, score, and errors", () => {
    const aggregates = createAggregate({
      completedRows: 10,
      errorRows: 2,
      overallPassRate: 60,
      overallAverageScore: 0.65,
    });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });

    // May appear in both inline and popover content
    expect(screen.getAllByText("60%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("0.65").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("2 errors").length).toBeGreaterThanOrEqual(1);
  });

  it("displays execution time (totalDuration) in tooltip", async () => {
    const user = userEvent.setup();
    const aggregates = createAggregate({
      completedRows: 5,
      totalDuration: 2500, // 2.5 seconds total
      averageLatency: 500, // 500ms average
      latencyStats: {
        min: 400,
        max: 600,
        avg: 500,
        median: 500,
        p75: 550,
        p90: 580,
        p95: 590,
        p99: 598,
        total: 2500,
        count: 5,
      },
    });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });

    // Hover to open tooltip
    const summary = screen.getByTestId("target-summary");
    await user.hover(summary);

    // Wait for tooltip to appear and check content
    await waitFor(() => {
      expect(
        screen.getAllByText("Execution Time").length,
      ).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText("2.5s").length).toBeGreaterThanOrEqual(1);
  });

  it("displays both average latency and execution time when both available", async () => {
    const user = userEvent.setup();
    const aggregates = createAggregate({
      completedRows: 3,
      totalDuration: 1500, // 1.5 seconds total
      averageLatency: 500, // 500ms average per row
      latencyStats: {
        min: 400,
        max: 600,
        avg: 500,
        median: 500,
        p75: 550,
        p90: 580,
        p95: 590,
        p99: 598,
        total: 1500,
        count: 3,
      },
    });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });

    // Hover to open tooltip
    const summary = screen.getByTestId("target-summary");
    await user.hover(summary);

    // Wait for tooltip to appear and check content
    await waitFor(() => {
      expect(screen.getAllByText("Avg Latency").length).toBeGreaterThanOrEqual(
        1,
      );
    });
    expect(screen.getAllByText("Execution Time").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getAllByText("500ms").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1.5s").length).toBeGreaterThanOrEqual(1);
  });

  it("displays caret indicator for latency with stats breakdown", async () => {
    const aggregates = createAggregate({
      completedRows: 3,
      averageLatency: 500,
      latencyStats: {
        min: 400,
        max: 600,
        avg: 500,
        median: 500,
        p75: 550,
        p90: 580,
        p95: 590,
        p99: 598,
        total: 1500,
        count: 3,
      },
    });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });

    // The inline summary should show the latency value with a caret
    expect(screen.getByText("500ms")).toBeInTheDocument();
  });

  it("displays cost stats breakdown on hover", async () => {
    const user = userEvent.setup();
    const aggregates = createAggregate({
      completedRows: 3,
      totalCost: 0.006,
      averageCost: 0.002,
      costStats: {
        min: 0.001,
        max: 0.003,
        avg: 0.002,
        median: 0.002,
        p75: 0.0025,
        p90: 0.0028,
        p95: 0.0029,
        p99: 0.00298,
        total: 0.006,
        count: 3,
      },
    });
    render(<TargetSummary aggregates={aggregates} />, { wrapper: Wrapper });

    // Hover to open tooltip
    const summary = screen.getByTestId("target-summary");
    await user.hover(summary);

    // Wait for tooltip to appear and check content includes cost
    await waitFor(() => {
      expect(screen.getAllByText("Total Cost").length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });
});
