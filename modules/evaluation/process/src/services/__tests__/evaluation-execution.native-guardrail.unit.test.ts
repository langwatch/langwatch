import {
  API_KEYS_AND_SECRETS_DETECTION,
  type EvaluatorApi,
  type EvaluatorResultAugmentationInput,
  type NativeEvaluatorExecutionInput,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
} from "../evaluation-execution.service.ts";

/**
 * Only executeNative and augmentResult are exercised by this dispatch path;
 * every other capability throws so an unexpected call fails loudly.
 */
function createFakeEvaluatorApi() {
  const executeNative = vi.fn(
    async (_input: NativeEvaluatorExecutionInput): Promise<SingleEvaluationResult> => ({
      status: "processed",
      passed: false,
      score: 1,
      details: "Detected 1 secret: provider_api_key (1)",
    }),
  );

  const augmentResult = vi.fn(
    (input: EvaluatorResultAugmentationInput): SingleEvaluationResult => input.result,
  );

  return createApiFixture<EvaluatorApi>({ executeNative, augmentResult });
}

function buildService(langevalsEvaluate: ReturnType<typeof vi.fn>) {
  const evaluators = createFakeEvaluatorApi();
  const deps = {
    traceService: {} as never,
    spanDigest: {} as never,
    modelEnvResolver: {} as never,
    langevalsClient: { evaluate: langevalsEvaluate },
    workflows: {} as never,
    evaluators,
    workflowExecutor: {} as never,
    installEnvironment: {} as never,
  } as unknown as EvaluationExecutionDeps;

  return { service: EvaluationExecutionService.create(deps), evaluators };
}

describe("EvaluationExecutionService guardrail dispatch", () => {
  describe("given a guardrail call to a native evaluator with a leaked key", () => {
    /** @scenario The secrets evaluator runs in-process as a guardrail */
    it("responds with a failed evaluation without calling the analysis service", async () => {
      const langevalsEvaluate = vi.fn();
      const { service, evaluators } = buildService(langevalsEvaluate);

      const result = await service.executeForData({
        projectId: "test-project-id",
        evaluatorType: API_KEYS_AND_SECRETS_DETECTION,
        data: {
          type: "default",
          data: { input: "here is my key sk-proj-aB3dEf_gHi-jKlMnOpQrStUvWx0123456789xY" },
        },
      });

      expect(result.status).toBe("processed");
      if (result.status !== "processed") throw new Error("unreachable");
      expect(result.passed).toBe(false);
      expect(evaluators.executeNative).toHaveBeenCalledWith(
        expect.objectContaining({ evaluatorType: API_KEYS_AND_SECRETS_DETECTION }),
      );
      expect(langevalsEvaluate).not.toHaveBeenCalled();
    });
  });
});
