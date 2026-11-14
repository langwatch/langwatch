import {
  LangevalsPiiDetectionError,
  type PiiDetectionRequest,
} from "@langwatch/evaluation-contract";
import {
  type BatchEvaluationResult,
  batchEvaluationResultSchema,
} from "@langwatch/evaluator-contract";

/** The route Presidio and the PII redaction model both answer a batch on. */
export const PII_DETECTION_PATH = "/presidio/pii_detection/evaluate";

const PII_DETECTION_MIN_THRESHOLD = 0.5;

/** The JSON body one batch is sent as, whichever service answers it. */
export function presidioDetectionBody(
  input: Pick<PiiDetectionRequest, "texts" | "entities">,
): string {
  return JSON.stringify({
    data: input.texts.map((text) => ({ input: text })),
    settings: {
      entities: Object.fromEntries(input.entities.map((name) => [name.toLowerCase(), true])),
      min_threshold: PII_DETECTION_MIN_THRESHOLD,
    },
    env: {},
  });
}

/** One result per text, in order, or a refusal: a short answer never passes as a clean one. */
export function readPresidioDetectionAnswer({
  answer,
  expected,
}: {
  answer: unknown;
  expected: number;
}): BatchEvaluationResult {
  const parsed = batchEvaluationResultSchema.safeParse(answer);
  if (!parsed.success || parsed.data.length !== expected) {
    throw new LangevalsPiiDetectionError(
      `Unexpected batch response: expected ${expected} results, got ${
        Array.isArray(answer) ? answer.length : "non-array"
      }`,
    );
  }

  return parsed.data;
}
