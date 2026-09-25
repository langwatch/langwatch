import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import { ClickHouseExperimentRunRepository } from "../clickhouse.experiment-run.repository.ts";

type Options = Parameters<typeof ClickHouseExperimentRunRepository.create>[0];

function rowsAnswering(query: string, items: Record<string, unknown>[]): unknown[] {
  if (query.includes("experiment_run_items")) return items;
  if (query.includes("FROM experiment_runs")) return [RUN];
  return [];
}

const RUN = {
  TenantId: "project_1",
  RunId: "run_1",
  ExperimentId: "experiment_1",
  WorkflowVersionId: null,
  Total: 4,
  Progress: 3,
  Targets: JSON.stringify([{ id: "t1", name: "Target", type: "prompt" }]),
  CreatedAt: "2026-09-01 10:00:00.000",
  UpdatedAt: "2026-09-01 10:05:00.000",
  FinishedAt: null,
  StoppedAt: null,
};

const ITEM = {
  TenantId: "project_1",
  RunId: "run_1",
  ExperimentId: "experiment_1",
  RowIndex: 0,
  TargetId: "t1",
  ResultType: "target",
  DatasetEntry: JSON.stringify({ question: "q" }),
  Predicted: null,
  TargetCost: 0.01,
  TargetDurationMs: 120,
  TargetError: null,
  TargetDomainError: null,
  TraceId: null,
  EvaluatorId: null,
  EvaluatorName: null,
  EvaluationStatus: "processed",
  Score: null,
  Label: null,
  Passed: null,
  EvaluationDetails: null,
  EvaluationCost: null,
  EvaluationInputs: null,
  EvaluationDurationMs: null,
};

function runRepositoryOver(items: Record<string, unknown>[]): Options {
  return {
    workflowVersions: createApiFixture<Options["workflowVersions"]>(),
    resolveClient: async () => ({
      query: async ({ query }: { query: string }) => ({
        json: async <Row>(): Promise<Row[]> =>
          JSON.parse(JSON.stringify(rowsAnswering(query, items))),
      }),
    }),
    tupleParam: (values: string[]) => values,
    telemetry: {
      trace: async <T>(_input: unknown, operation: () => Promise<T>) => operation(),
      warnOldRuns: () => {},
      error: () => {},
      warn: () => {},
    },
  };
}

const ITEM_VARIANTS: Record<string, unknown>[] = [
  ITEM,
  { ...ITEM, RowIndex: 1, TargetId: "default", Predicted: JSON.stringify({ answer: "a" }) },
  { ...ITEM, RowIndex: 2, TargetId: "", DatasetEntry: "not json", TargetError: "boom" },
  { ...ITEM, RowIndex: 3, TargetDomainError: JSON.stringify({ code: "not_found" }), TraceId: "tr" },
  { ...ITEM, Predicted: "[1]", TargetCost: null, TargetDurationMs: null },
  {
    ...ITEM,
    ResultType: "evaluator",
    EvaluatorId: "ev1",
    EvaluatorName: "Judge",
    Score: 0.5,
    Label: "good",
    Passed: 1,
    EvaluationDetails: "ok",
    EvaluationCost: 0.002,
    EvaluationInputs: JSON.stringify({ input: "q" }),
    EvaluationDurationMs: 30,
  },
  { ...ITEM, ResultType: "evaluator", TargetId: "default", EvaluationStatus: "skipped", Passed: 0 },
  { ...ITEM, ResultType: "evaluator", EvaluationStatus: "weird", EvaluationInputs: "[]" },
];

describe("ClickHouseExperimentRunRepository.findRun item mapping", () => {
  it("maps target rows to dataset entries and evaluator rows to evaluations", async () => {
    const repository = ClickHouseExperimentRunRepository.create(runRepositoryOver(ITEM_VARIANTS));

    const run = await repository.findRun({
      projectId: "project_1",
      experimentId: "experiment_1",
      runId: "run_1",
    });

    expect({ dataset: run?.dataset, evaluations: run?.evaluations }).toMatchInlineSnapshot(`
      {
        "dataset": [
          {
            "cost": 0.01,
            "duration": 120,
            "entry": {
              "question": "q",
            },
            "error": null,
            "index": 0,
            "targetId": "t1",
            "traceId": null,
          },
          {
            "cost": 0.01,
            "duration": 120,
            "entry": {
              "question": "q",
            },
            "error": null,
            "index": 1,
            "predicted": {
              "answer": "a",
            },
            "targetId": null,
            "traceId": null,
          },
          {
            "cost": 0.01,
            "duration": 120,
            "entry": {},
            "error": "boom",
            "index": 2,
            "targetId": null,
            "traceId": null,
          },
          {
            "cost": 0.01,
            "duration": 120,
            "entry": {
              "question": "q",
            },
            "error": null,
            "index": 3,
            "targetId": "t1",
            "traceId": "tr",
          },
          {
            "cost": null,
            "duration": null,
            "entry": {
              "question": "q",
            },
            "error": null,
            "index": 0,
            "targetId": "t1",
            "traceId": null,
          },
        ],
        "evaluations": [
          {
            "cost": 0.002,
            "details": "ok",
            "duration": 30,
            "evaluator": "ev1",
            "index": 0,
            "inputs": {
              "input": "q",
            },
            "label": "good",
            "name": "Judge",
            "passed": true,
            "score": 0.5,
            "status": "processed",
            "targetId": "t1",
          },
          {
            "cost": null,
            "details": null,
            "duration": null,
            "evaluator": "",
            "index": 0,
            "inputs": null,
            "label": null,
            "name": null,
            "passed": false,
            "score": null,
            "status": "skipped",
            "targetId": null,
          },
          {
            "cost": null,
            "details": null,
            "duration": null,
            "evaluator": "",
            "index": 0,
            "inputs": null,
            "label": null,
            "name": null,
            "passed": null,
            "score": null,
            "status": "error",
            "targetId": "t1",
          },
        ],
      }
    `);
  });
});
