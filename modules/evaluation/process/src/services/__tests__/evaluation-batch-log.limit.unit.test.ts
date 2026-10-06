/** @see modules/evaluation/specs/evaluation-service.feature */
import { DATASET_DEFAULT_LIMITS, type DatasetApi } from "@langwatch/dataset-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { EvaluationCommandDispatcherService } from "../evaluation-command-dispatcher.service.ts";
import {
  EvaluationBatchLogService,
  type EvaluationExperimentDirectory,
  type EvaluationExperimentRunWriter,
} from "../evaluation-batch-log.service.ts";

const PROJECT_ID = "project-1";
const DEFAULT_LIMIT = DATASET_DEFAULT_LIMITS.rowBytes;

/** A batch log whose organization answers the given row limit; nothing else is reachable. */
function batchLog(rowBytes: number = DEFAULT_LIMIT) {
  const asked: string[] = [];
  const service = EvaluationBatchLogService.create({
    experiments: createApiFixture<EvaluationExperimentDirectory>(),
    runs: createApiFixture<EvaluationExperimentRunWriter>(),
    report: createApiFixture<Pick<EvaluationCommandDispatcherService, "reportEvaluation">>(),
    limits: createApiFixture<DatasetApi>({
      getLimits: async ({ projectId }) => {
        asked.push(projectId);

        return { ...DATASET_DEFAULT_LIMITS, rowBytes };
      },
    }),
  });

  return { service, asked };
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
