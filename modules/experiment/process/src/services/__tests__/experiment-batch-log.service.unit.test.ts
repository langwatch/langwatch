/** @see modules/experiment/specs/experiment-batch-log.feature */
import { DATASET_DEFAULT_LIMITS, type DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { Experiment } from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ExperimentBatchLogService } from "../experiment-batch-log.service.ts";
import type { ExperimentFindOrCreateService } from "../experiment-find-or-create.service.ts";
import type { ExperimentService } from "../experiment.service.ts";

const PROJECT_ID = "project-1";
const DEFAULT_LIMIT = DATASET_DEFAULT_LIMITS.rowBytes;

type Runs = Pick<
  ExperimentService,
  "startExperimentRun" | "recordTargetResult" | "recordEvaluatorResult" | "completeExperimentRun"
>;

/** A batch log whose organization answers the given row limit; nothing else is reachable. */
function batchLog(rowBytes: number = DEFAULT_LIMIT) {
  const asked: string[] = [];
  const service = ExperimentBatchLogService.create({
    runLookup: createApiFixture<Pick<ExperimentFindOrCreateService, "resolve">>(),
    runs: createApiFixture<Runs>(),
    report: createApiFixture<Pick<EvaluationApi, "reportEvaluation">>(),
    limits: createApiFixture<DatasetApi>({
      getLimits: async ({ projectId }) => {
        asked.push(projectId);

        return { ...DATASET_DEFAULT_LIMITS, rowBytes };
      },
    }),
  });

  return { service, asked };
}

/** A batch log that records every write it is handed, in order. */
function recordingBatchLog() {
  const calls: [string, Record<string, unknown>][] = [];
  const record =
    (name: string) =>
    async (input: object): Promise<void> => {
      calls.push([name, { ...input }]);
    };
  const service = ExperimentBatchLogService.create({
    runLookup: {
      resolve: async (input) => {
        calls.push(["findOrCreateForRun", { ...input }]);

        return { id: "experiment-1", slug: "nightly" } as Experiment;
      },
    },
    runs: {
      startExperimentRun: record("startExperimentRun"),
      recordTargetResult: record("recordTargetResult"),
      recordEvaluatorResult: record("recordEvaluatorResult"),
      completeExperimentRun: record("completeExperimentRun"),
    },
    report: { reportEvaluation: record("reportEvaluation") },
    limits: createApiFixture<DatasetApi>(),
  });

  return { service, calls };
}

describe("given an organization that sets no file limit of its own", () => {
  describe("when a batch smaller than one full dataset row is reported", () => {
    /** @scenario "A batch of results within the organization's limit is accepted" */
    it("accepts a body far above 20 MB, up to the limit itself", async () => {
      const { service, asked } = batchLog();

      await expect(
        service.assertWithinLimit({ projectId: PROJECT_ID, payloadBytes: 100 * 1024 * 1024 }),
      ).resolves.toBeUndefined();
      await expect(
        service.assertWithinLimit({ projectId: PROJECT_ID, payloadBytes: DEFAULT_LIMIT }),
      ).resolves.toBeUndefined();
      expect(asked).toEqual([PROJECT_ID, PROJECT_ID]);
    });
  });

  describe("when a batch larger than one full dataset row is reported", () => {
    /** @scenario "A batch of results above the organization's limit is refused by name" */
    it("refuses it with the organization's limit", async () => {
      const { service } = batchLog();

      await expect(
        service.assertWithinLimit({ projectId: PROJECT_ID, payloadBytes: DEFAULT_LIMIT + 1 }),
      ).rejects.toMatchObject({
        code: "evaluation_log_results_too_large",
        httpStatus: 413,
        meta: { maxBytes: DEFAULT_LIMIT },
      });
    });
  });
});

describe("given an organization whose file limit was raised", () => {
  describe("when a batch above the default limit and below its own is reported", () => {
    /** @scenario "An organization with a raised file limit reports a batch the default limit refuses" */
    it("accepts it", async () => {
      const { service } = batchLog(2 * DEFAULT_LIMIT);

      await expect(
        service.assertWithinLimit({ projectId: PROJECT_ID, payloadBytes: DEFAULT_LIMIT + 1 }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given an SDK logs a batch of evaluation results", () => {
  /** @scenario "An SDK batch is written into its experiment's run history and its verdicts reported to evaluation" */
  it("finds or creates the experiment, then starts, fills and completes its run, then reports each verdict", async () => {
    const { service, calls } = recordingBatchLog();

    await service.log({
      projectId: PROJECT_ID,
      params: {
        experiment_slug: "nightly",
        run_id: "run-1",
        dataset: [{ index: 0, entry: { input: "hello" }, predicted: { output: "hi" } }],
        evaluations: [{ evaluator: "exact", index: 0, status: "processed", score: 1 }],
        timestamps: { finished_at: 1_700_000_000_000 },
      },
    });

    expect(calls.map(([name]) => name)).toEqual([
      "findOrCreateForRun",
      "startExperimentRun",
      "recordTargetResult",
      "recordEvaluatorResult",
      "completeExperimentRun",
      "reportEvaluation",
    ]);
    expect(calls[0]?.[1]).toMatchObject({
      projectId: PROJECT_ID,
      experimentSlug: "nightly",
      experimentType: "BATCH_EVALUATION_V2",
    });
    expect(calls[3]?.[1]).toMatchObject({
      tenantId: PROJECT_ID,
      runId: "run-1",
      experimentId: "experiment-1",
      evaluatorId: "exact",
      status: "processed",
      score: 1,
    });
    expect(calls[5]?.[1]).toMatchObject({
      tenantId: PROJECT_ID,
      evaluationId: "local_eval_run-1_exact_0_",
      score: 1,
    });
  });
});
