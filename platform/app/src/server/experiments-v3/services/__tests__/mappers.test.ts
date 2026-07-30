import { describe, expect, it } from "vitest";
import { emptyExperimentRunTotals } from "~/server/event-sourcing/experiment-run-processing/totals";
import type {
  ClickHouseEvaluatorBreakdownRow,
  ClickHouseExperimentRunItemRow,
  ClickHouseExperimentRunRow,
} from "../mappers";
import {
  mapClickHouseItemsToRunWithItems,
  mapClickHouseRunToExperimentRun,
} from "../mappers";
import type { ExperimentRunWorkflowVersion } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseClickHouseRun: ClickHouseExperimentRunRow = {
  ProjectionId: "id-1",
  TenantId: "project-1",
  RunId: "run-1",
  ExperimentId: "exp-1",
  WorkflowVersionId: "wfv-1",
  Version: "1",
  Total: 10,
  Targets: "[]",
  CreatedAt: "2024-01-15 10:30:00.000",
  UpdatedAt: "2024-01-15 10:35:00.000",
  FinishedAt: "2024-01-15 10:40:00.000",
  StoppedAt: null,
};

const workflowVersion: ExperimentRunWorkflowVersion = {
  id: "wfv-1",
  version: "v1",
  commitMessage: "initial",
  author: { name: "Alice", image: null },
};

const evaluatorBreakdown: ClickHouseEvaluatorBreakdownRow[] = [
  {
    ExperimentId: "exp-1",
    RunId: "run-1",
    EvaluatorId: "eval-1",
    EvaluatorName: "Accuracy",
    avgScore: 0.9,
    passRate: 0.8,
    hasPassedCount: 4,
  },
  {
    ExperimentId: "exp-1",
    RunId: "run-1",
    EvaluatorId: "eval-2",
    EvaluatorName: null,
    avgScore: 0.7,
    passRate: null,
    hasPassedCount: 0,
  },
];

// ---------------------------------------------------------------------------
// mapClickHouseRunToExperimentRun
// ---------------------------------------------------------------------------

describe("mapClickHouseRunToExperimentRun", () => {
  it("maps PascalCase fields to camelCase", () => {
    const result = mapClickHouseRunToExperimentRun({
      record: baseClickHouseRun,
    });

    expect(result.experimentId).toBe("exp-1");
    expect(result.runId).toBe("run-1");
    expect(result.total).toBe(10);
  });

  describe("given derived totals for the run", () => {
    /** @scenario Progress and outcomes reflect the run's items */
    it("reports progress from the derived totals, not a counter on the row", () => {
      const result = mapClickHouseRunToExperimentRun({
        record: baseClickHouseRun,
        totals: { ...emptyExperimentRunTotals(), progress: 7 },
      });

      expect(result.progress).toBe(7);
    });

    it("reports null progress when no item has landed yet, distinct from zero", () => {
      const withNoItems = mapClickHouseRunToExperimentRun({
        record: baseClickHouseRun,
      });
      const withZeroProgress = mapClickHouseRunToExperimentRun({
        record: baseClickHouseRun,
        totals: emptyExperimentRunTotals(),
      });

      expect(withNoItems.progress).toBeNull();
      expect(withZeroProgress.progress).toBe(0);
    });
  });

  it("parses ClickHouse DateTime64 strings to UTC Unix milliseconds", () => {
    const result = mapClickHouseRunToExperimentRun({
      record: baseClickHouseRun,
    });

    expect(result.timestamps.createdAt).toBe(
      Date.parse("2024-01-15T10:30:00.000Z"),
    );
    expect(result.timestamps.updatedAt).toBe(
      Date.parse("2024-01-15T10:35:00.000Z"),
    );
    expect(result.timestamps.finishedAt).toBe(
      Date.parse("2024-01-15T10:40:00.000Z"),
    );
  });

  it("sets finishedAt and stoppedAt to null when absent", () => {
    const row = { ...baseClickHouseRun, FinishedAt: null, StoppedAt: null };
    const result = mapClickHouseRunToExperimentRun({ record: row });

    expect(result.timestamps.finishedAt).toBeNull();
    expect(result.timestamps.stoppedAt).toBeNull();
  });

  it("attaches workflow version when provided", () => {
    const result = mapClickHouseRunToExperimentRun({
      record: baseClickHouseRun,
      workflowVersion,
    });
    expect(result.workflowVersion).toEqual(workflowVersion);
  });

  it("sets workflowVersion to null when not provided", () => {
    const result = mapClickHouseRunToExperimentRun({
      record: baseClickHouseRun,
    });
    expect(result.workflowVersion).toBeNull();
  });

  /** @scenario Progress and outcomes reflect the run's items */
  it("aggregates evaluator breakdown into summary evaluations", () => {
    const result = mapClickHouseRunToExperimentRun({
      record: baseClickHouseRun,
      workflowVersion: null,
      evaluatorBreakdown,
    });

    expect(result.summary.evaluations["eval-1"]).toEqual({
      name: "Accuracy",
      averageScore: 0.9,
      averagePassed: 0.8,
    });
  });

  it("uses EvaluatorId as name fallback when EvaluatorName is null", () => {
    const result = mapClickHouseRunToExperimentRun({
      record: baseClickHouseRun,
      workflowVersion: null,
      evaluatorBreakdown,
    });

    expect(result.summary.evaluations["eval-2"]!.name).toBe("eval-2");
  });

  it("omits averagePassed when hasPassedCount is 0", () => {
    const result = mapClickHouseRunToExperimentRun({
      record: baseClickHouseRun,
      workflowVersion: null,
      evaluatorBreakdown,
    });

    expect(result.summary.evaluations["eval-2"]!.averagePassed).toBeUndefined();
  });

  it("returns empty evaluations when no breakdown provided", () => {
    const result = mapClickHouseRunToExperimentRun({
      record: baseClickHouseRun,
    });
    expect(result.summary.evaluations).toEqual({});
  });

  describe("when a cost summary derived from the run's items is supplied", () => {
    /** @scenario Progress and outcomes reflect the run's items */
    it("reports the item-derived costs and durations, not the run row's", () => {
      const result = mapClickHouseRunToExperimentRun({
        record: baseClickHouseRun,
        costSummary: {
          ExperimentId: "exp-1",
          RunId: "run-1",
          datasetCost: 0.03,
          evaluationsCost: 0.002,
          datasetAverageCost: 0.01,
          datasetAverageDuration: 400,
          evaluationsAverageCost: 0.001,
          evaluationsAverageDuration: 25,
        },
      });

      expect(result.summary.datasetCost).toBe(0.03);
      expect(result.summary.evaluationsCost).toBe(0.002);
      expect(result.summary.datasetAverageDuration).toBe(400);
      expect(result.summary.evaluationsAverageDuration).toBe(25);
    });
  });

  describe("when no item-derived cost summary is supplied", () => {
    it("reports no cost at all rather than a figure carried on the run row", () => {
      const result = mapClickHouseRunToExperimentRun({
        record: baseClickHouseRun,
      });

      expect(result.summary.datasetCost).toBeUndefined();
      expect(result.summary.evaluationsCost).toBeUndefined();
      expect(result.summary.datasetAverageDuration).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// mapClickHouseItemsToRunWithItems
// ---------------------------------------------------------------------------

describe("mapClickHouseItemsToRunWithItems", () => {
  const targetItem: ClickHouseExperimentRunItemRow = {
    ProjectionId: "item-1",
    TenantId: "project-1",
    RunId: "run-1",
    ExperimentId: "exp-1",
    RowIndex: 0,
    TargetId: "target-1",
    ResultType: "target",
    DatasetEntry: JSON.stringify({ input: "hello" }),
    Predicted: JSON.stringify({ output: "world" }),
    TargetCost: 0.01,
    TargetDurationMs: 100,
    TargetError: null,
    TargetDomainError: null,
    TraceId: "trace-1",
    EvaluatorId: null,
    EvaluatorName: null,
    EvaluationStatus: "",
    Score: null,
    Label: null,
    Passed: null,
    EvaluationDetails: null,
    EvaluationCost: null,
    EvaluationInputs: null,
    EvaluationDurationMs: null,
    CreatedAt: "2024-01-15 10:30:00.000",
  };

  const evaluatorItem: ClickHouseExperimentRunItemRow = {
    ProjectionId: "item-2",
    TenantId: "project-1",
    RunId: "run-1",
    ExperimentId: "exp-1",
    RowIndex: 0,
    TargetId: "target-1",
    ResultType: "evaluator",
    DatasetEntry: "{}",
    Predicted: null,
    TargetCost: null,
    TargetDurationMs: null,
    TargetError: null,
    TargetDomainError: null,
    TraceId: null,
    EvaluatorId: "eval-1",
    EvaluatorName: "Accuracy",
    EvaluationStatus: "processed",
    Score: 0.95,
    Label: "good",
    Passed: 1,
    EvaluationDetails: "looks good",
    EvaluationCost: 0.001,
    EvaluationInputs: null,
    EvaluationDurationMs: null,
    CreatedAt: "2024-01-15 10:30:01.000",
  };

  it("separates target and evaluator items", () => {
    const result = mapClickHouseItemsToRunWithItems({
      runRecord: baseClickHouseRun,
      items: [targetItem, evaluatorItem],
      projectId: "project-1",
    });

    expect(result.dataset).toHaveLength(1);
    expect(result.evaluations).toHaveLength(1);
  });

  /** @scenario An item that reports its own cost keeps that figure */
  it("maps target item fields correctly", () => {
    const result = mapClickHouseItemsToRunWithItems({
      runRecord: baseClickHouseRun,
      items: [targetItem],
      projectId: "project-1",
    });

    const entry = result.dataset[0]!;
    expect(entry.index).toBe(0);
    expect(entry.targetId).toBe("target-1");
    expect(entry.entry).toEqual({ input: "hello" });
    expect(entry.predicted).toEqual({ output: "world" });
    expect(entry.cost).toBe(0.01);
    expect(entry.duration).toBe(100);
    expect(entry.traceId).toBe("trace-1");
  });

  it("maps evaluator item fields correctly", () => {
    const result = mapClickHouseItemsToRunWithItems({
      runRecord: baseClickHouseRun,
      items: [evaluatorItem],
      projectId: "project-1",
    });

    const evaluation = result.evaluations[0]!;
    expect(evaluation.evaluator).toBe("eval-1");
    expect(evaluation.name).toBe("Accuracy");
    expect(evaluation.status).toBe("processed");
    expect(evaluation.score).toBe(0.95);
    expect(evaluation.label).toBe("good");
    expect(evaluation.passed).toBe(true);
    expect(evaluation.details).toBe("looks good");
    expect(evaluation.cost).toBe(0.001);
  });

  it("converts UInt8 Passed to boolean", () => {
    const passedItem = { ...evaluatorItem, Passed: 0 };
    const result = mapClickHouseItemsToRunWithItems({
      runRecord: baseClickHouseRun,
      items: [passedItem],
      projectId: "project-1",
    });

    expect(result.evaluations[0]!.passed).toBe(false);
  });

  it("maps null Passed to null", () => {
    const nullPassedItem = { ...evaluatorItem, Passed: null };
    const result = mapClickHouseItemsToRunWithItems({
      runRecord: baseClickHouseRun,
      items: [nullPassedItem],
      projectId: "project-1",
    });

    expect(result.evaluations[0]!.passed).toBeNull();
  });

  it("threads projectId through", () => {
    const result = mapClickHouseItemsToRunWithItems({
      runRecord: baseClickHouseRun,
      items: [],
      projectId: "my-project",
    });

    expect(result.projectId).toBe("my-project");
  });

  it("parses JSON Targets from run record", () => {
    const runWithTargets = {
      ...baseClickHouseRun,
      Targets: JSON.stringify([{ id: "t1", name: "Target 1" }]),
    };
    const result = mapClickHouseItemsToRunWithItems({
      runRecord: runWithTargets,
      items: [],
      projectId: "project-1",
    });

    expect(result.targets).toEqual([{ id: "t1", name: "Target 1" }]);
  });

  it("handles invalid Targets JSON gracefully", () => {
    const runWithBadTargets = { ...baseClickHouseRun, Targets: "not-json" };
    const result = mapClickHouseItemsToRunWithItems({
      runRecord: runWithBadTargets,
      items: [],
      projectId: "project-1",
    });

    expect(result.targets).toBeNull();
  });

  it("handles empty items array", () => {
    const result = mapClickHouseItemsToRunWithItems({
      runRecord: baseClickHouseRun,
      items: [],
      projectId: "project-1",
    });

    expect(result.dataset).toEqual([]);
    expect(result.evaluations).toEqual([]);
  });

  describe("when DatasetEntry JSON is invalid", () => {
    it("falls back to empty object", () => {
      const badEntry = { ...targetItem, DatasetEntry: "not-json" };
      const result = mapClickHouseItemsToRunWithItems({
        runRecord: baseClickHouseRun,
        items: [badEntry],
        projectId: "project-1",
      });

      expect(result.dataset[0]!.entry).toEqual({});
    });
  });

  describe("when Predicted JSON is invalid", () => {
    it("falls back to undefined", () => {
      const badPredicted = { ...targetItem, Predicted: "not-json" };
      const result = mapClickHouseItemsToRunWithItems({
        runRecord: baseClickHouseRun,
        items: [badPredicted],
        projectId: "project-1",
      });

      expect(result.dataset[0]!.predicted).toBeUndefined();
    });
  });

  describe("given derived totals for the run", () => {
    /** @scenario Progress and outcomes reflect the run's items */
    it("reports progress from the derived totals, not a counter on the row", () => {
      const result = mapClickHouseItemsToRunWithItems({
        runRecord: baseClickHouseRun,
        items: [targetItem],
        projectId: "project-1",
        totals: { ...emptyExperimentRunTotals(), progress: 3 },
      });

      expect(result.progress).toBe(3);
    });

    it("reports null progress when no item has landed yet, distinct from zero", () => {
      const withNoItems = mapClickHouseItemsToRunWithItems({
        runRecord: baseClickHouseRun,
        items: [],
        projectId: "project-1",
      });
      const withZeroProgress = mapClickHouseItemsToRunWithItems({
        runRecord: baseClickHouseRun,
        items: [],
        projectId: "project-1",
        totals: emptyExperimentRunTotals(),
      });

      expect(withNoItems.progress).toBeNull();
      expect(withZeroProgress.progress).toBe(0);
    });
  });
});
