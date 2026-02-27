import { describe, expect, it } from "vitest";
import type {
  ClickHouseEvaluatorBreakdownRow,
  ClickHouseExperimentRunItemRow,
  ClickHouseExperimentRunRow,
  ESRunAggregationBucket,
} from "../mappers";
import {
  mapClickHouseItemsToRunWithItems,
  mapClickHouseRunToExperimentRun,
  mapEsBatchEvaluationToRunWithItems,
  mapEsRunToExperimentRun,
} from "../mappers";
import type { ExperimentRunWorkflowVersion } from "../types";
import type { ESBatchEvaluation } from "~/server/experiments/types";

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
  Progress: 5,
  CompletedCount: 4,
  FailedCount: 1,
  TotalCost: 0.5,
  TotalDurationMs: 1200,
  AvgScoreBps: 8500,
  PassRateBps: 9000,
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
    RunId: "run-1",
    EvaluatorId: "eval-1",
    EvaluatorName: "Accuracy",
    avgScore: 0.9,
    passRate: 0.8,
    hasPassedCount: 4,
  },
  {
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
    const result = mapClickHouseRunToExperimentRun({ record: baseClickHouseRun });

    expect(result.experimentId).toBe("exp-1");
    expect(result.runId).toBe("run-1");
    expect(result.progress).toBe(5);
    expect(result.total).toBe(10);
  });

  it("parses ClickHouse DateTime64 strings to UTC Unix milliseconds", () => {
    const result = mapClickHouseRunToExperimentRun({ record: baseClickHouseRun });

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
    const result = mapClickHouseRunToExperimentRun({ record: baseClickHouseRun });
    expect(result.workflowVersion).toBeNull();
  });

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

    expect(
      result.summary.evaluations["eval-2"]!.averagePassed,
    ).toBeUndefined();
  });

  it("returns empty evaluations when no breakdown provided", () => {
    const result = mapClickHouseRunToExperimentRun({ record: baseClickHouseRun });
    expect(result.summary.evaluations).toEqual({});
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
});

// ---------------------------------------------------------------------------
// mapEsRunToExperimentRun
// ---------------------------------------------------------------------------

describe("mapEsRunToExperimentRun", () => {
  const esSource = {
    experiment_id: "exp-1",
    run_id: "run-1",
    workflow_version_id: "wfv-1",
    timestamps: {
      created_at: 1705312200000,
      inserted_at: 1705312200000,
      updated_at: 1705312500000,
      finished_at: 1705312800000,
      stopped_at: null,
    },
    progress: 10,
    total: 10,
  };

  const runAgg: ESRunAggregationBucket = {
    key: "run-1",
    dataset_cost: { value: 0.5 },
    evaluations_cost: {
      cost: { value: 0.1 },
      average_cost: { value: 0.01 },
      average_duration: { value: 200 },
    },
    dataset_average_cost: { value: 0.05 },
    dataset_average_duration: { value: 500 },
    evaluations: {
      child: {
        buckets: [
          {
            key: "eval-1",
            name: { buckets: [{ key: "Accuracy" }] },
            processed_evaluations: {
              average_score: { value: 0.9 },
              has_passed: { doc_count: 5 },
              average_passed: { value: 0.8 },
            },
          },
        ],
      },
    },
  };

  it("maps snake_case fields to camelCase", () => {
    const result = mapEsRunToExperimentRun(esSource, undefined);

    expect(result.experimentId).toBe("exp-1");
    expect(result.runId).toBe("run-1");
    expect(result.timestamps.createdAt).toBe(1705312200000);
    expect(result.timestamps.updatedAt).toBe(1705312500000);
    expect(result.timestamps.finishedAt).toBe(1705312800000);
    expect(result.timestamps.stoppedAt).toBeNull();
  });

  it("maps aggregation bucket costs to summary", () => {
    const result = mapEsRunToExperimentRun(esSource, runAgg);

    expect(result.summary.datasetCost).toBe(0.5);
    expect(result.summary.evaluationsCost).toBe(0.1);
    expect(result.summary.datasetAverageCost).toBe(0.05);
    expect(result.summary.datasetAverageDuration).toBe(500);
    expect(result.summary.evaluationsAverageCost).toBe(0.01);
    expect(result.summary.evaluationsAverageDuration).toBe(200);
  });

  it("maps evaluations from aggregation buckets", () => {
    const result = mapEsRunToExperimentRun(esSource, runAgg);

    expect(result.summary.evaluations["eval-1"]).toEqual({
      name: "Accuracy",
      averageScore: 0.9,
      averagePassed: 0.8,
    });
  });

  it("omits averagePassed when has_passed.doc_count is 0", () => {
    const aggNoPassed: ESRunAggregationBucket = {
      ...runAgg,
      evaluations: {
        child: {
          buckets: [
            {
              key: "eval-1",
              name: { buckets: [{ key: "Accuracy" }] },
              processed_evaluations: {
                average_score: { value: 0.9 },
                has_passed: { doc_count: 0 },
                average_passed: { value: null },
              },
            },
          ],
        },
      },
    };

    const result = mapEsRunToExperimentRun(esSource, aggNoPassed);
    expect(
      result.summary.evaluations["eval-1"]!.averagePassed,
    ).toBeUndefined();
  });

  it("falls back to bucket key when name buckets is empty", () => {
    const aggNoName: ESRunAggregationBucket = {
      ...runAgg,
      evaluations: {
        child: {
          buckets: [
            {
              key: "eval-1",
              name: { buckets: [] },
              processed_evaluations: {
                average_score: { value: 0.5 },
                has_passed: { doc_count: 0 },
                average_passed: { value: null },
              },
            },
          ],
        },
      },
    };

    const result = mapEsRunToExperimentRun(esSource, aggNoName);
    expect(result.summary.evaluations["eval-1"]!.name).toBe("eval-1");
  });

  it("returns empty evaluations when runAgg is undefined", () => {
    const result = mapEsRunToExperimentRun(esSource, undefined);
    expect(result.summary.evaluations).toEqual({});
  });

  it("sets cost fields to undefined when runAgg is undefined", () => {
    const result = mapEsRunToExperimentRun(esSource, undefined);
    expect(result.summary.datasetCost).toBeUndefined();
    expect(result.summary.evaluationsCost).toBeUndefined();
  });

  it("attaches workflow version when provided", () => {
    const result = mapEsRunToExperimentRun(
      esSource,
      undefined,
      workflowVersion,
    );
    expect(result.workflowVersion).toEqual(workflowVersion);
  });
});

// ---------------------------------------------------------------------------
// mapEsBatchEvaluationToRunWithItems
// ---------------------------------------------------------------------------

describe("mapEsBatchEvaluationToRunWithItems", () => {
  const esDoc: ESBatchEvaluation = {
    project_id: "project-1",
    experiment_id: "exp-1",
    run_id: "run-1",
    workflow_version_id: "wfv-1",
    progress: 2,
    total: 2,
    targets: [
      {
        id: "t1",
        name: "Prompt A",
        type: "prompt",
        prompt_id: "p1",
        prompt_version: 1,
        agent_id: null,
        evaluator_id: null,
        model: "gpt-4",
        metadata: { temperature: 0.7 },
      },
    ],
    dataset: [
      {
        index: 0,
        target_id: "t1",
        entry: { input: "hi" },
        predicted: { output: "hello" },
        cost: 0.01,
        duration: 100,
        error: null,
        trace_id: "trace-1",
      },
    ],
    evaluations: [
      {
        evaluator: "eval-1",
        name: "Accuracy",
        target_id: "t1",
        status: "processed",
        index: 0,
        score: 0.9,
        label: "good",
        passed: true,
        details: "correct",
        cost: 0.001,
        duration: 50,
        inputs: { predicted: "hello" },
      },
    ],
    timestamps: {
      created_at: 1705312200000,
      inserted_at: 1705312200000,
      updated_at: 1705312500000,
      finished_at: 1705312800000,
      stopped_at: null,
    },
  };

  it("maps top-level fields from snake_case to camelCase", () => {
    const result = mapEsBatchEvaluationToRunWithItems(esDoc);

    expect(result.experimentId).toBe("exp-1");
    expect(result.runId).toBe("run-1");
    expect(result.projectId).toBe("project-1");
    expect(result.workflowVersionId).toBe("wfv-1");
    expect(result.progress).toBe(2);
    expect(result.total).toBe(2);
  });

  it("maps dataset entries from snake_case to camelCase", () => {
    const result = mapEsBatchEvaluationToRunWithItems(esDoc);
    const entry = result.dataset[0]!;

    expect(entry.index).toBe(0);
    expect(entry.targetId).toBe("t1");
    expect(entry.entry).toEqual({ input: "hi" });
    expect(entry.predicted).toEqual({ output: "hello" });
    expect(entry.cost).toBe(0.01);
    expect(entry.duration).toBe(100);
    expect(entry.traceId).toBe("trace-1");
  });

  it("maps evaluation entries from snake_case to camelCase", () => {
    const result = mapEsBatchEvaluationToRunWithItems(esDoc);
    const evaluation = result.evaluations[0]!;

    expect(evaluation.evaluator).toBe("eval-1");
    expect(evaluation.name).toBe("Accuracy");
    expect(evaluation.targetId).toBe("t1");
    expect(evaluation.status).toBe("processed");
    expect(evaluation.score).toBe(0.9);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.details).toBe("correct");
    expect(evaluation.inputs).toEqual({ predicted: "hello" });
  });

  it("maps targets from snake_case to camelCase", () => {
    const result = mapEsBatchEvaluationToRunWithItems(esDoc);
    const target = result.targets![0]!;

    expect(target.id).toBe("t1");
    expect(target.name).toBe("Prompt A");
    expect(target.type).toBe("prompt");
    expect(target.promptId).toBe("p1");
    expect(target.promptVersion).toBe(1);
    expect(target.model).toBe("gpt-4");
    expect(target.metadata).toEqual({ temperature: 0.7 });
  });

  it("maps timestamps from snake_case to camelCase", () => {
    const result = mapEsBatchEvaluationToRunWithItems(esDoc);

    expect(result.timestamps.createdAt).toBe(1705312200000);
    expect(result.timestamps.updatedAt).toBe(1705312500000);
    expect(result.timestamps.finishedAt).toBe(1705312800000);
    expect(result.timestamps.stoppedAt).toBeNull();
  });

  it("handles null targets", () => {
    const docNoTargets = { ...esDoc, targets: undefined };
    const result = mapEsBatchEvaluationToRunWithItems(docNoTargets);
    expect(result.targets).toBeNull();
  });

  it("handles empty dataset and evaluations", () => {
    const emptyDoc = { ...esDoc, dataset: [], evaluations: [] };
    const result = mapEsBatchEvaluationToRunWithItems(emptyDoc);
    expect(result.dataset).toEqual([]);
    expect(result.evaluations).toEqual([]);
  });
});
