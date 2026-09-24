import { createApiFixture } from "@langwatch/api-fixture";
import {
  API_KEYS_AND_SECRETS_DETECTION,
  type EvaluatorApi,
  type EvaluatorResultAugmentationInput,
  type NativeEvaluatorExecutionInput,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, type Mock, vi } from "vitest";

import type { EvaluationLangevals } from "../../app/evaluation.members.ts";
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

  return { api: createApiFixture<EvaluatorApi>({ executeNative, augmentResult }), executeNative };
}

function unused(member: string) {
  return (): never => {
    throw new Error(`${member} is not reached by the guardrail dispatch`);
  };
}

function buildService(langevalsEvaluate: Mock<EvaluationLangevals["evaluate"]>) {
  const { api: evaluators, executeNative } = createFakeEvaluatorApi();
  const deps: EvaluationExecutionDeps = {
    traces: {
      readTracesWithSpans: unused("traces.readTracesWithSpans"),
      readEvaluations: unused("traces.readEvaluations"),
      readThreadsTraces: unused("traces.readThreadsTraces"),
    },
    spanDigest: { format: unused("spanDigest.format") },
    modelEnvResolver: { resolveForEvaluator: unused("modelEnvResolver.resolveForEvaluator") },
    langevalsClient: { evaluate: langevalsEvaluate },
    workflows: createApiFixture<WorkflowApi>({}),
    evaluators,
    workflowExecutor: { run: unused("workflowExecutor.run") },
    installEnvironment: {},
  };

  return { service: EvaluationExecutionService.create(deps), executeNative };
}

describe("EvaluationExecutionService guardrail dispatch", () => {
  describe("given a guardrail call to a native evaluator with a leaked key", () => {
    /** @scenario The secrets evaluator runs in-process as a guardrail */
    it("responds with a failed evaluation without calling the analysis service", async () => {
      const langevalsEvaluate = vi.fn<EvaluationLangevals["evaluate"]>();
      const { service, executeNative } = buildService(langevalsEvaluate);

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
      expect(executeNative).toHaveBeenCalledWith(
        expect.objectContaining({ evaluatorType: API_KEYS_AND_SECRETS_DETECTION }),
      );
      expect(langevalsEvaluate).not.toHaveBeenCalled();
    });
  });
});
