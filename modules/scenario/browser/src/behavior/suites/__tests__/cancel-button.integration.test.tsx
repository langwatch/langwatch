/**
 * Integration tests for cancel buttons on scenario run rows and batch headers.
 * @vitest-environment jsdom
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenarioTargetRow } from "../../../ui/elements/suite/runs/scenario-target-row.tsx";
import { RunRow } from "../../../ui/sections/suite/run-row.tsx";
import { makeBatchRun, makeScenarioRunData, makeSummary } from "./run-history-fixtures.ts";

vi.mock("../use-prefetch-run-state.ts", () => ({
  usePrefetchRunState: () => vi.fn(),
}));

describe("<ScenarioTargetRow/> cancel button", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given a pending scenario run with onCancel", () => {
    /** @scenario "User cancels a single running job from the run card" */
    it("displays the cancel button", () => {
      renderWithDesignSystem(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.PENDING,
            durationInMs: 0,
          })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByTestId("cancel-run-button")).toBeInTheDocument();
    });
  });

  describe("given an in-progress scenario run with onCancel", () => {
    it("displays the cancel button", () => {
      renderWithDesignSystem(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.IN_PROGRESS,
            durationInMs: 0,
          })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByTestId("cancel-run-button")).toBeInTheDocument();
    });
  });

  describe("given a stalled scenario run with onCancel", () => {
    it("does not display the cancel button", () => {
      // STALLED is not in CANCELLABLE_STATUSES — the enum explicitly lists it as
      // a terminal status alongside SUCCESS, FAILED, ERROR, and CANCELLED.
      // Only QUEUED, PENDING, and IN_PROGRESS are cancellable.
      renderWithDesignSystem(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.STALLED,
            durationInMs: 0,
          })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("given a completed scenario run with onCancel", () => {
    /** @scenario "Cancel button is hidden for jobs that already completed" */
    it("does not display the cancel button", () => {
      renderWithDesignSystem(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.SUCCESS,
          })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("given a failed scenario run with onCancel", () => {
    it("does not display the cancel button", () => {
      renderWithDesignSystem(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.FAILED,
          })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("given a cancelled scenario run with onCancel", () => {
    it("does not display the cancel button", () => {
      renderWithDesignSystem(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.CANCELLED,
            durationInMs: 0,
          })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("given a cancellable run without onCancel prop", () => {
    it("does not display the cancel button", () => {
      renderWithDesignSystem(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.PENDING,
            durationInMs: 0,
          })}
          targetName="Agent"
          onClick={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("when the cancel button is clicked", () => {
    it("calls onCancel and does not propagate to row onClick", async () => {
      // pointerEventsCheck disabled because the cancel button uses CSS
      // _groupHover to toggle pointer-events, which jsdom cannot simulate
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const onCancel = vi.fn();
      const onClick = vi.fn();

      renderWithDesignSystem(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.PENDING,
            durationInMs: 0,
          })}
          targetName="Agent"
          onClick={onClick}
          onCancel={onCancel}
        />,
      );

      await user.click(screen.getByTestId("cancel-run-button"));
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onClick).not.toHaveBeenCalled();
    });
  });
});

describe("<RunRow/> cancel all button", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given a batch with cancellable runs and onCancelAll", () => {
    it("displays the Cancel All button", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({
            scenarioRunId: "r1",
            status: ScenarioRunStatus.PENDING,
            durationInMs: 0,
          }),
          makeScenarioRunData({
            scenarioRunId: "r2",
            status: ScenarioRunStatus.SUCCESS,
          }),
        ],
      });

      renderWithDesignSystem(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary({
            inProgressCount: 1,
            passedCount: 1,
            totalCount: 2,
          })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={vi.fn()}
          onCancelAll={vi.fn()}
        />,
      );

      expect(screen.getByTestId("cancel-all-button")).toBeInTheDocument();
    });
  });

  describe("given a batch with no cancellable runs and onCancelAll", () => {
    it("does not display the Cancel All button", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({
            scenarioRunId: "r1",
            status: ScenarioRunStatus.SUCCESS,
          }),
          makeScenarioRunData({
            scenarioRunId: "r2",
            status: ScenarioRunStatus.FAILED,
          }),
        ],
      });

      renderWithDesignSystem(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary({
            passedCount: 1,
            failedCount: 1,
            totalCount: 2,
          })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={vi.fn()}
          onCancelAll={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("cancel-all-button")).not.toBeInTheDocument();
    });
  });

  describe("given a batch with all cancelled runs and onCancelAll", () => {
    it("does not display the Cancel All button", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({
            scenarioRunId: "r1",
            status: ScenarioRunStatus.CANCELLED,
            durationInMs: 0,
          }),
          makeScenarioRunData({
            scenarioRunId: "r2",
            status: ScenarioRunStatus.CANCELLED,
            durationInMs: 0,
          }),
        ],
      });

      renderWithDesignSystem(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary({
            cancelledCount: 2,
            totalCount: 2,
            passedCount: 0,
            passRate: 0,
          })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={vi.fn()}
          onCancelAll={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("cancel-all-button")).not.toBeInTheDocument();
    });
  });

  describe("given a batch without onCancelAll prop", () => {
    it("does not display the Cancel All button", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({
            scenarioRunId: "r1",
            status: ScenarioRunStatus.PENDING,
            durationInMs: 0,
          }),
        ],
      });

      renderWithDesignSystem(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary({
            inProgressCount: 1,
            totalCount: 1,
            passedCount: 0,
            passRate: 0,
          })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("cancel-all-button")).not.toBeInTheDocument();
    });
  });

  describe("when Cancel All button is clicked", () => {
    /** @scenario "User cancels all remaining jobs for a batch run" */
    it("calls onCancelAll and does not toggle the row", async () => {
      // pointerEventsCheck disabled because the cancel button uses CSS
      // _groupHover to toggle pointer-events, which jsdom cannot simulate
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const onCancelAll = vi.fn();
      const onToggle = vi.fn();

      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({
            scenarioRunId: "r1",
            status: ScenarioRunStatus.IN_PROGRESS,
            durationInMs: 0,
          }),
        ],
      });

      renderWithDesignSystem(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary({
            inProgressCount: 1,
            totalCount: 1,
            passedCount: 0,
            passRate: 0,
          })}
          isExpanded={false}
          onToggle={onToggle}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={vi.fn()}
          onCancelAll={onCancelAll}
        />,
      );

      await user.click(screen.getByTestId("cancel-all-button"));
      // Cancel All opens a confirmation dialog — confirm to trigger the callback
      await user.click(screen.getByTestId("confirm-cancel-all-button"));
      expect(onCancelAll).toHaveBeenCalledOnce();
      expect(onToggle).not.toHaveBeenCalled();
    });
  });
});
