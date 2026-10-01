/**
 * RunRow component integration tests.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { SimulationRunStatus as ScenarioRunStatus } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunRow } from "../run-row.tsx";
import { cssRulesForElement } from "./emotion-test-css.ts";
import { makeBatchRun, makeScenarioRunData, makeSummary } from "./run-history-fixtures.ts";

describe("<RunRow/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when collapsed", () => {
    it("displays pass rate in metrics summary pill", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      expect(screen.getByText("Pass")).toBeInTheDocument();
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("does not display scenario x target rows", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      expect(screen.queryByText(/Angry refund request/)).not.toBeInTheDocument();
    });
  });

  describe("when expanded", () => {
    it("displays scenario x target rows", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      expect(screen.getByText(/Angry refund request/)).toBeInTheDocument();
      expect(screen.getByText(/Policy violation/)).toBeInTheDocument();
    });

    it("displays target name in scenario x target format in list view", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
          viewMode="list"
        />,
      );

      expect(screen.getByText(/Prod Agent: Angry refund request/)).toBeInTheDocument();
    });

    it("displays duration for finished runs in list view", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
          viewMode="list"
        />,
      );

      const durationElements = screen.getAllByText("2.3s");
      expect(durationElements.length).toBeGreaterThan(0);
    });
  });

  describe("when the header is clicked", () => {
    it("calls onToggle", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();

      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={onToggle}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      const header = screen.getByRole("button", { name: /Run from/ });
      await user.click(header);
      expect(onToggle).toHaveBeenCalledOnce();
    });
  });

  describe("given a batch with runs that can still be stopped", () => {
    function renderStoppable({ isCancellingBatch = false } = {}) {
      const onToggle = vi.fn();
      const onCancelAll = vi.fn();
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun({
            scenarioRuns: [makeScenarioRunData({ status: ScenarioRunStatus.IN_PROGRESS })],
          })}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={onToggle}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
          onCancelAll={onCancelAll}
          isCancellingBatch={isCancellingBatch}
        />,
      );
      return { onToggle, onCancelAll };
    }

    it("offers stop as its own button beside the header's toggle", () => {
      renderStoppable();

      const toggle = screen.getByRole("button", { name: /Run from/ });
      const stop = screen.getByRole("button", { name: "Stop all remaining runs" });
      expect(toggle.contains(stop)).toBe(false);
    });

    it("asks to confirm the stop without toggling the run", async () => {
      const user = userEvent.setup();
      const { onToggle, onCancelAll } = renderStoppable();

      await user.click(screen.getByRole("button", { name: "Stop all remaining runs" }));
      await user.click(await screen.findByTestId("confirm-cancel-all-button"));

      expect(onCancelAll).toHaveBeenCalledOnce();
      expect(onToggle).not.toHaveBeenCalled();
    });

    it("disables stop while the batch is being stopped", () => {
      renderStoppable({ isCancellingBatch: true });

      expect(screen.getByRole("button", { name: "Stop all remaining runs" })).toBeDisabled();
    });
  });

  describe("when a scenario x target row is clicked", () => {
    it("calls onScenarioRunClick with the scenario run data", async () => {
      const user = userEvent.setup();
      const onScenarioRunClick = vi.fn();
      const scenarioRun = makeScenarioRunData();

      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun({ scenarioRuns: [scenarioRun] })}
          summary={makeSummary({ totalCount: 1, passedCount: 1 })}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={onScenarioRunClick}
        />,
      );

      const row = screen.getByLabelText(/View details for/);
      await user.click(row);
      expect(onScenarioRunClick).toHaveBeenCalledWith(scenarioRun);
    });
  });

  describe("when summary shows failures", () => {
    it("displays pass rate reflecting failures", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary({
            passedCount: 2,
            failedCount: 1,
            passRate: 67,
          })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      expect(screen.getByText("67%")).toBeInTheDocument();
    });
  });

  describe("when expectedJobCount is provided", () => {
    describe("when not all jobs are done", () => {
      it("displays progress indicator next to status counts", () => {
        renderWithDesignSystem(
          <RunRow
            batchRun={makeBatchRun()}
            summary={makeSummary({ totalCount: 2 })}
            isExpanded={false}
            onToggle={vi.fn()}
            resolveTargetName={() => "Prod Agent"}
            onScenarioRunClick={vi.fn()}
            expectedJobCount={6}
          />,
        );

        expect(screen.getByText("2 of 6")).toBeInTheDocument();
      });
    });

    describe("when all jobs are done", () => {
      it("does not display progress indicator", () => {
        renderWithDesignSystem(
          <RunRow
            batchRun={makeBatchRun()}
            summary={makeSummary({ totalCount: 6 })}
            isExpanded={false}
            onToggle={vi.fn()}
            resolveTargetName={() => "Prod Agent"}
            onScenarioRunClick={vi.fn()}
            expectedJobCount={6}
          />,
        );

        expect(screen.queryByText(/of 6/)).not.toBeInTheDocument();
      });
    });
  });

  describe("when expectedJobCount is not provided", () => {
    it("does not display progress indicator", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary({ totalCount: 2 })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      expect(screen.queryByText(/of \d+/)).not.toBeInTheDocument();
    });
  });

  describe("when suiteName is provided (All Runs view)", () => {
    it("displays suite name in header", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => null}
          onScenarioRunClick={vi.fn()}
          suiteName="My Suite"
        />,
      );

      expect(screen.getByText("My Suite")).toBeInTheDocument();
    });
  });

  describe("when viewing summary metrics in header", () => {
    it("displays pass rate pill in header", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary({
            passedCount: 8,
            failedCount: 2,
            passRate: 80,
          })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      expect(screen.getByText("Pass")).toBeInTheDocument();
      expect(screen.getByText("80%")).toBeInTheDocument();
    });

    it("renders RunMetricsSummary inside the header", () => {
      const { container } = renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary({
            passedCount: 8,
            failedCount: 2,
            passRate: 80,
          })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      const header = container.querySelector('[data-testid="run-row-header"]');
      expect(header).toBeInTheDocument();
      const metrics = header?.querySelector('[data-testid="run-metrics-summary"]');
      expect(metrics).toBeInTheDocument();
    });
  });

  describe("when checking for footer removal", () => {
    it("does not render a RunSummaryFooter when expanded", () => {
      const { container } = renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      expect(container.querySelector('[data-testid="run-summary-footer"]')).not.toBeInTheDocument();
    });

    it("does not render a RunSummaryFooter when collapsed", () => {
      const { container } = renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      expect(container.querySelector('[data-testid="run-summary-footer"]')).not.toBeInTheDocument();
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

      renderWithDesignSystem(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      expect(screen.queryByText("Checkout Flow, Login Flow")).not.toBeInTheDocument();
    });
  });

  describe("when rendering the sticky header's backdrop blur", () => {
    /** @scenario "Blur effects turn off when the device can't keep a smooth frame rate" */
    it("references the shared --lw-backdrop-blur and --lw-panel-alpha CSS variables instead of hardcoded values", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      // Scope the assertion to the sticky header's OWN generated class, not
      // every injected <style> — otherwise an unrelated rule referencing the
      // same variable would keep this green after the header regresses to a
      // hard-coded blur.
      const header = screen.getAllByTestId("run-row-header")[0]!;
      const headerCss = cssRulesForElement(header);
      expect(headerCss).toContain("--lw-backdrop-blur");
      // The header's background is semi-transparent specifically because
      // the blur diffuses whatever shows through it — removing just the
      // blur while leaving that transparency would turn a frosted header
      // into a literal see-through window onto the scrolling list behind
      // it, so --lw-panel-alpha must go with it.
      expect(headerCss).toContain("--lw-panel-alpha");
    });
  });
});
