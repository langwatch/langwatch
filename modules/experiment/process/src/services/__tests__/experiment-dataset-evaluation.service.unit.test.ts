/** @see modules/experiment/specs/experiment-dataset-evaluation.feature */
import type { EvaluationApi, EvaluationMonitorSummary } from "@langwatch/evaluation-contract";
import type { Experiment } from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ExperimentDatasetEvaluationService } from "../experiment-dataset-evaluation.service.ts";
import type { ExperimentService } from "../experiment.service.ts";

const PROJECT_ID = "project-1";

type Evaluations = Pick<
  EvaluationApi,
  | "findMonitorBySlug"
  | "listCustomEvaluators"
  | "findDatasetBySlug"
  | "runEvaluator"
  | "recordEvaluationCost"
  | "recordDatasetEvaluationRow"
>;

const NIGHTLY = { id: "experiment-1", slug: "nightly" } as Experiment;

/** A dataset evaluation over recording doubles; `overrides` replace evaluation's answers. */
function datasetEvaluation(overrides: Partial<Evaluations> = {}) {
  const calls: [string, unknown][] = [];
  const record =
    <T>(name: string, value: T) =>
    async (input: unknown): Promise<T> => {
      calls.push([name, input]);

      return value;
    };
  const service = ExperimentDatasetEvaluationService.create({
    experiments: createApiFixture<Pick<ExperimentService, "findBySlug">>({
      findBySlug: async (input) => {
        calls.push(["findBySlug", input]);

        return input.slug === "nightly" ? NIGHTLY : null;
      },
    }),
    evaluation: createApiFixture<Evaluations>({
      findMonitorBySlug: record<EvaluationMonitorSummary | null>("findMonitorBySlug", null),
      listCustomEvaluators: record("listCustomEvaluators", []),
      findDatasetBySlug: record("findDatasetBySlug", { id: "dataset-1" }),
      runEvaluator: record("runEvaluator", {
        status: "processed" as const,
        score: 0.5,
        passed: true,
        cost: { currency: "USD", amount: 0.01 },
      }),
      recordEvaluationCost: record("recordEvaluationCost", { id: "cost-1" }),
      recordDatasetEvaluationRow: record("recordDatasetEvaluationRow", undefined),
      ...overrides,
    }),
  });

  return { service, calls, names: () => calls.map(([name]) => name) };
}

const INPUT = {
  projectId: PROJECT_ID,
  evaluation: "langevals/basic",
  datasetSlug: "golden-set",
  experimentSlug: "nightly",
  data: { input: "hi", output: "hello" },
};

describe("given a dataset evaluation names an experiment by slug", () => {
  /** @scenario "A dataset evaluation's experiment slug resolves through the experiment owner" */
  it("records its cost and its row against that experiment's id, after the run", async () => {
    const { service, calls, names } = datasetEvaluation();

    await expect(service.evaluate(INPUT)).resolves.toMatchObject({
      outcome: "evaluated",
      result: { status: "processed", score: 0.5 },
    });
    expect(names()).toEqual([
      "findMonitorBySlug",
      "listCustomEvaluators",
      "findDatasetBySlug",
      "runEvaluator",
      "findBySlug",
      "recordEvaluationCost",
      "recordDatasetEvaluationRow",
    ]);
    expect(Object.fromEntries(calls)).toMatchObject({
      findBySlug: { projectId: PROJECT_ID, slug: "nightly" },
      recordEvaluationCost: { referenceType: "BATCH", referenceId: "experiment-1", amount: 0.01 },
      recordDatasetEvaluationRow: {
        experimentId: "experiment-1",
        datasetId: "dataset-1",
        score: 0.5,
        passed: true,
        cost: 0.01,
        evaluation: "langevals/basic",
      },
    });
  });

  /** @scenario "A dataset evaluation's experiment slug resolves through the experiment owner" */
  it("refuses a slug the project does not hold as not_found after the run, writing nothing", async () => {
    const { service, names } = datasetEvaluation();

    await expect(service.evaluate({ ...INPUT, experimentSlug: "absent" })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(names()).toContain("runEvaluator");
    expect(names()).not.toContain("recordDatasetEvaluationRow");
  });
});

describe("given a dataset evaluation it cannot run", () => {
  /** @scenario "A dataset evaluation refuses what it cannot run with main's status and body" */
  it("names an evaluator neither built-in nor custom as not found", async () => {
    const { service } = datasetEvaluation();

    await expect(service.evaluate({ ...INPUT, evaluation: "nope/none" })).resolves.toEqual({
      outcome: "evaluator_not_found",
      checkType: "nope/none",
    });
  });

  /** @scenario "A dataset evaluation refuses what it cannot run with main's status and body" */
  it("names the fields the evaluator requires when the entry lacks one", async () => {
    const { service } = datasetEvaluation({
      listCustomEvaluators: async () => [
        {
          id: "workflow-1",
          name: "Asks a question",
          versions: [
            {
              dsl: {
                nodes: [],
                edges: [{ source: "entry", sourceHandle: "outputs.question", target: "llm" }],
              },
            },
          ],
        },
      ],
    });

    await expect(
      service.evaluate({ ...INPUT, evaluation: "custom/workflow-1", data: { output: "x" } }),
    ).resolves.toEqual({
      outcome: "missing_field",
      checkType: "custom/workflow-1",
      requiredFields: ["question"],
    });
  });

  /** @scenario "A dataset evaluation refuses what it cannot run with main's status and body" */
  it("answers data the evaluator input rule refuses with its sentence", async () => {
    const { service } = datasetEvaluation();

    await expect(
      service.evaluate({ ...INPUT, data: { conversation: "not a list" } }),
    ).resolves.toMatchObject({ outcome: "invalid_data", sentence: expect.any(String) });
  });

  /** @scenario "A dataset evaluation refuses what it cannot run with main's status and body" */
  it("answers a dataset slug the project does not hold before anything runs", async () => {
    const { service, names } = datasetEvaluation({ findDatasetBySlug: async () => null });

    await expect(service.evaluate(INPUT)).resolves.toEqual({ outcome: "dataset_not_found" });
    expect(names()).not.toContain("runEvaluator");
  });

  /** @scenario "A dataset evaluation refuses what it cannot run with main's status and body" */
  it("answers a run that throws as an errored result, not a refusal", async () => {
    const { service } = datasetEvaluation({
      runEvaluator: async () => {
        throw new Error("langevals unreachable");
      },
    });

    await expect(service.evaluate(INPUT)).resolves.toEqual({
      outcome: "evaluated",
      result: {
        status: "error",
        error_type: "INTERNAL_ERROR",
        details: "langevals unreachable",
        traceback: [],
      },
    });
  });
});
