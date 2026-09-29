import { batchEvaluationResultSchema } from "@langwatch/evaluator-contract";
import { z } from "zod";

/**
 * langevals' batch answer as the evaluator contract reads it. Pydantic sends an
 * unset optional field (`label`, `cost`, `details`, ...) as `null`, which the
 * contract has as absent; main passed the answer through unchecked.
 */
export const langevalsBatchResultSchema = z.preprocess(
  (answer) => (Array.isArray(answer) ? answer.map(withoutNullFields) : answer),
  batchEvaluationResultSchema,
);

function withoutNullFields(entry: unknown): unknown {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== null));
}
