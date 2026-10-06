/** @see modules/experiment/specs/experiment-run-results-completeness.feature */
import { DATASET_DEFAULT_LIMITS, type DatasetApi } from "@langwatch/dataset-contract";
import { eSBatchEvaluationRESTParamsSchema } from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  EvaluationBatchLogService,
  type EvaluationExperimentDirectory,
  type EvaluationExperimentRunWriter,
} from "../evaluation-batch-log.service.ts";
import type { EvaluationCommandDispatcherService } from "../evaluation-command-dispatcher.service.ts";

type CompleteRunInput = Parameters<EvaluationExperimentRunWriter["completeRun"]>[0];

/** A batch log over a run writer that keeps every completion it is asked for. */
function batchLog() {
  const completions: CompleteRunInput[] = [];
  const service = EvaluationBatchLogService.create({
    experiments: createApiFixture<EvaluationExperimentDirectory>({
      findOrCreate: async () => ({ id: "experiment_1" }),
    }),
    runs: createApiFixture<EvaluationExperimentRunWriter>({
      startRun: async () => undefined,
      completeRun: async (input) => {
        completions.push(input);
      },
    }),
    report: createApiFixture<Pick<EvaluationCommandDispatcherService, "reportEvaluation">>(),
    limits: createApiFixture<DatasetApi>({
      getLimits: async () => DATASET_DEFAULT_LIMITS,
    }),
  });

  return { service, completions };
}

describe("given an SDK batch that reports a finish", () => {
  describe("when it carries the 4 rows and 12 verdicts the run reported", () => {
    /** @scenario "The finishing batch carries the counts the run reported" */
    it("completes the run with those expected counts", async () => {
      const { service, completions } = batchLog();

      await service.log({
        projectId: "project_1",
        params: eSBatchEvaluationRESTParamsSchema.parse({
          experiment_slug: "claims",
          run_id: "run_1",
          timestamps: { finished_at: 5_000 },
          expected: { dataset: 4, evaluations: 12 },
        }),
      });

      expect(completions).toHaveLength(1);
      expect(completions[0]).toMatchObject({
        runId: "run_1",
        experimentId: "experiment_1",
        finishedAt: 5_000,
        expected: { dataset: 4, evaluations: 12 },
      });
    });
  });

  describe("when it comes from an SDK that sends no counts", () => {
    it("completes the run without expected counts", async () => {
      const { service, completions } = batchLog();

      await service.log({
        projectId: "project_1",
        params: eSBatchEvaluationRESTParamsSchema.parse({
          experiment_slug: "claims",
          run_id: "run_1",
          timestamps: { finished_at: 5_000 },
        }),
      });

      expect(completions[0]?.expected).toBeUndefined();
    });
  });
});

describe("given an SDK batch that reports no finish", () => {
  describe("when it is logged with expected counts", () => {
    it("does not complete the run", async () => {
      const { service, completions } = batchLog();

      await service.log({
        projectId: "project_1",
        params: eSBatchEvaluationRESTParamsSchema.parse({
          experiment_slug: "claims",
          run_id: "run_1",
          expected: { dataset: 4, evaluations: 12 },
        }),
      });

      expect(completions).toHaveLength(0);
    });
  });
});

describe("given an SDK batch whose expected verdict count is negative", () => {
  describe("when the batch is validated", () => {
    /** @scenario "A batch with a negative expected count is refused" */
    it("is refused as invalid", () => {
      const parsed = eSBatchEvaluationRESTParamsSchema.safeParse({
        experiment_slug: "claims",
        run_id: "run_1",
        timestamps: { finished_at: 5_000 },
        expected: { dataset: 4, evaluations: -1 },
      });

      expect(parsed.success).toBe(false);
    });

    it("is refused when a count is not a whole number", () => {
      const parsed = eSBatchEvaluationRESTParamsSchema.safeParse({
        run_id: "run_1",
        expected: { dataset: 1.5, evaluations: 3 },
      });

      expect(parsed.success).toBe(false);
    });
  });
});
