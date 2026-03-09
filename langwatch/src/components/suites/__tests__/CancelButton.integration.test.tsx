/**
 * @vitest-environment jsdom
 *
 * Integration tests for cancel buttons on scenario run rows and batch headers.
 *
 * Tests the display and interaction of cancel buttons:
 * - Individual cancel button appears only for cancellable statuses
 * - Cancel All button appears when there are cancellable runs
 * - Cancelled runs do not show cancel buttons
 * - Click handlers fire correctly
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { ScenarioTargetRow } from "../ScenarioTargetRow";
import { ScenarioGridCard } from "../ScenarioGridCard";
import { RunRow } from "../RunRow";
import { makeScenarioRunData, makeBatchRun, makeSummary } from "./test-helpers";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ScenarioTargetRow/> cancel button", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given a pending scenario run with onCancel", () => {
    it("displays the cancel button", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.PENDING, durationInMs: 0 })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("cancel-run-button")).toBeInTheDocument();
    });
  });

  describe("given an in-progress scenario run with onCancel", () => {
    it("displays the cancel button", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.IN_PROGRESS, durationInMs: 0 })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("cancel-run-button")).toBeInTheDocument();
    });
  });

  describe("given a stalled scenario run with onCancel", () => {
    it("displays the cancel button", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.STALLED, durationInMs: 0 })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("cancel-run-button")).toBeInTheDocument();
    });
  });

  describe("given a completed scenario run with onCancel", () => {
    it("does not display the cancel button", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("given a failed scenario run with onCancel", () => {
    it("does not display the cancel button", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.FAILED })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("given a cancelled scenario run with onCancel", () => {
    it("does not display the cancel button", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.CANCELLED, durationInMs: 0 })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("given a cancellable run without onCancel prop", () => {
    it("does not display the cancel button", () => {
      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.PENDING, durationInMs: 0 })}
          targetName="Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("when the cancel button is clicked", () => {
    it("calls onCancel and does not propagate to row onClick", async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      const onClick = vi.fn();

      render(
        <ScenarioTargetRow
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.PENDING, durationInMs: 0 })}
          targetName="Agent"
          onClick={onClick}
          onCancel={onCancel}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("cancel-run-button"));
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onClick).not.toHaveBeenCalled();
    });
  });
});

describe("<ScenarioGridCard/> cancel button", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given a pending scenario run with onCancel", () => {
    it("displays the cancel button", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.PENDING, durationInMs: 0 })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("cancel-run-button")).toBeInTheDocument();
    });
  });

  describe("given a completed scenario run with onCancel", () => {
    it("does not display the cancel button", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("given a cancellable run without onCancel prop", () => {
    it("does not display the cancel button", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.PENDING, durationInMs: 0 })}
          targetName="Agent"
          onClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    });
  });

  describe("when the cancel button is clicked", () => {
    it("calls onCancel and does not propagate to card onClick", async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      const onClick = vi.fn();

      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({ status: ScenarioRunStatus.PENDING, durationInMs: 0 })}
          targetName="Agent"
          onClick={onClick}
          onCancel={onCancel}
        />,
        { wrapper: Wrapper },
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
          makeScenarioRunData({ scenarioRunId: "r1", status: ScenarioRunStatus.PENDING, durationInMs: 0 }),
          makeScenarioRunData({ scenarioRunId: "r2", status: ScenarioRunStatus.SUCCESS }),
        ],
      });

      render(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary({ inProgressCount: 1, passedCount: 1, totalCount: 2 })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={vi.fn()}
          onCancelAll={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("cancel-all-button")).toBeInTheDocument();
    });
  });

  describe("given a batch with no cancellable runs and onCancelAll", () => {
    it("does not display the Cancel All button", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ scenarioRunId: "r1", status: ScenarioRunStatus.SUCCESS }),
          makeScenarioRunData({ scenarioRunId: "r2", status: ScenarioRunStatus.FAILED }),
        ],
      });

      render(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary({ passedCount: 1, failedCount: 1, totalCount: 2 })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={vi.fn()}
          onCancelAll={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("cancel-all-button")).not.toBeInTheDocument();
    });
  });

  describe("given a batch with all cancelled runs and onCancelAll", () => {
    it("does not display the Cancel All button", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ scenarioRunId: "r1", status: ScenarioRunStatus.CANCELLED, durationInMs: 0 }),
          makeScenarioRunData({ scenarioRunId: "r2", status: ScenarioRunStatus.CANCELLED, durationInMs: 0 }),
        ],
      });

      render(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary({ cancelledCount: 2, totalCount: 2, passedCount: 0, passRate: 0 })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={vi.fn()}
          onCancelAll={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("cancel-all-button")).not.toBeInTheDocument();
    });
  });

  describe("given a batch without onCancelAll prop", () => {
    it("does not display the Cancel All button", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ scenarioRunId: "r1", status: ScenarioRunStatus.PENDING, durationInMs: 0 }),
        ],
      });

      render(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary({ inProgressCount: 1, totalCount: 1, passedCount: 0, passRate: 0 })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("cancel-all-button")).not.toBeInTheDocument();
    });
  });

  describe("when Cancel All button is clicked", () => {
    it("calls onCancelAll and does not toggle the row", async () => {
      const user = userEvent.setup();
      const onCancelAll = vi.fn();
      const onToggle = vi.fn();

      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ scenarioRunId: "r1", status: ScenarioRunStatus.IN_PROGRESS, durationInMs: 0 }),
        ],
      });

      render(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary({ inProgressCount: 1, totalCount: 1, passedCount: 0, passRate: 0 })}
          isExpanded={false}
          onToggle={onToggle}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={vi.fn()}
          onCancelAll={onCancelAll}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("cancel-all-button"));
      expect(onCancelAll).toHaveBeenCalledOnce();
      expect(onToggle).not.toHaveBeenCalled();
    });
  });
});
