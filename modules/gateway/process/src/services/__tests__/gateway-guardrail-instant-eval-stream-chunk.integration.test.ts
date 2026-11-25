/**
 * @vitest-environment node
 * A chunk of a streamed reply, checked by a fail-closed guardrail whose judge is on Instant
 * Evals, runs through the evaluation's own guardrail check and execution, is skipped and
 * allowed, and never reaches the classifier (ADR-174 decision 16).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import type { EvaluationApi, GuardrailCheckOutcome } from "@langwatch/evaluation-contract";
import { instantEvalGuardrailCheckOver } from "@langwatch/evaluation-process/testing";
import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  type InstantEvalJudgeApi,
} from "@langwatch/instant-eval-judge-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { GatewayGuardrailRepository } from "../../repositories/gateway-guardrail.repository.ts";
import { GatewayGuardrailEvaluationService } from "../gateway-guardrail-evaluation.service.ts";

const PROJECT_ID = "proj-stream";

function gatewayOverEvaluation() {
  const judge = vi.fn<InstantEvalJudgeApi["judge"]>(() => {
    throw new Error("a stream chunk check never reaches the classifier");
  });
  const evaluation = instantEvalGuardrailCheckOver({ judges: { judge } });
  const outcomes: GuardrailCheckOutcome[] = [];
  const gateway = GatewayGuardrailEvaluationService.create({
    repository: createApiFixture<GatewayGuardrailRepository>({
      findRunnableForCheck: async () => [
        { id: "gr-polite", name: "Polite", evaluatorId: "ev-polite", failureMode: "FAIL_CLOSED" },
      ],
    }),
    monitors: createApiFixture<MonitorApi>({
      listEnabledGuardrailMonitors: async () => [
        {
          id: "mon-polite",
          evaluatorId: "ev-polite",
          checkType: "langevals/llm_boolean",
          parameters: { model: INSTANT_EVAL_JUDGE_MODEL_ID, prompt: "is the reply polite?" },
        },
      ],
    }),
    evaluations: createApiFixture<EvaluationApi>({
      checkGuardrail: async (input) => {
        const outcome = await evaluation.checkGuardrail(input);
        outcomes.push(outcome);
        return outcome;
      },
    }),
  });

  return { gateway, judge, outcomes };
}

describe("Gateway guardrail over a judge on Instant Evals", () => {
  describe("given a fail-closed guardrail whose judge is on Instant Evals", () => {
    describe("when the gateway checks a chunk of a streamed reply", () => {
      /** @scenario "A stream chunk sent through the gateway's guardrail check never reaches the classifier" */
      it("skips the evaluation, allows the chunk and never calls the classifier", async () => {
        const { gateway, judge, outcomes } = gatewayOverEvaluation();

        const verdict = await gateway.check({
          projectId: PROJECT_ID,
          guardrailIds: ["gr-polite"],
          direction: "stream_chunk",
          content: { chunk: "you are" },
        });

        expect(outcomes).toEqual([
          {
            status: "evaluated",
            result: {
              status: "skipped",
              details: expect.stringContaining("guardrail_stream_chunk"),
            },
          },
        ]);
        expect(verdict).toMatchObject({ status: "evaluated", verdict: { decision: "allow" } });
        expect(judge).not.toHaveBeenCalled();
      });
    });
  });
});
