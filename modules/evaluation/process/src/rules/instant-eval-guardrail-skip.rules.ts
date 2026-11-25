/**
 * Which guardrail checks Instant Evals answers without judging (ADR-174 decision 16).
 * A guardrail can run on every chunk of a streamed reply, so judging chunks would charge one
 * reply many times. The gateway reads the skip as allow.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import type { GuardrailCheckDirection } from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";

import { instantEvalSkipResultOf } from "./instant-eval-judge-result.rules.ts";

const SKIPPED_GUARDRAIL_DIRECTION: GuardrailCheckDirection = "stream_chunk";

/** The skipped result for a check Instant Evals never judges, or `judged` when the judge runs. */
export function instantEvalGuardrailSkipOf({
  direction,
}: {
  direction: GuardrailCheckDirection | undefined;
}): { kind: "skipped"; result: SingleEvaluationResult } | { kind: "judged" } {
  if (direction !== SKIPPED_GUARDRAIL_DIRECTION) return { kind: "judged" };

  return { kind: "skipped", result: instantEvalSkipResultOf("guardrail_stream_chunk") };
}
