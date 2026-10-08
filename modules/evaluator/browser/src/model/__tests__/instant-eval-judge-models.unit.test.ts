/**
 * Only an LLM judge is answered by Instant Evals, so only its picker offers it;
 * every other picker still names a saved Instant Evals model.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { instantEvalJudgeModelsOf } from "../instant-eval-judge-models.ts";

describe("instantEvalJudgeModelsOf", () => {
  /** @scenario "Only an LLM judge's model picker offers Instant Evals" */
  it.each([
    { released: true, evaluatorType: "langevals/llm_boolean", offered: true },
    { released: true, evaluatorType: "langevals/llm_score", offered: true },
    { released: true, evaluatorType: "langevals/llm_category", offered: true },
    { released: true, evaluatorType: "ragas/faithfulness", offered: false },
    { released: true, evaluatorType: "langevals/off_topic", offered: false },
    { released: true, evaluatorType: undefined, offered: false },
    { released: false, evaluatorType: "langevals/llm_boolean", offered: false },
  ])(
    "offers Instant Evals on $evaluatorType released $released: $offered, and still names it",
    (example) => {
      const { builtInModels, offered } = instantEvalJudgeModelsOf({
        evaluatorType: example.evaluatorType,
        released: example.released,
      });

      expect(offered).toBe(example.offered);
      expect(builtInModels.some((model) => model.isOffered !== false)).toBe(example.offered);
      expect(builtInModels).toEqual([
        expect.objectContaining({ value: INSTANT_EVAL_JUDGE_MODEL_ID, label: "Instant Evals" }),
      ]);
    },
  );
});
