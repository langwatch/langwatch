import {
  LangevalsPiiDetectionError,
  type PiiDetectionOutcome,
  type PiiDetectionRequest,
} from "@langwatch/evaluation-contract";
import { batchEvaluationResultSchema } from "@langwatch/evaluator-contract";

import type { PresidioChannel } from "../presidio.channel.ts";

const PII_DETECTION_PATH = "/presidio/pii_detection/evaluate";
const PII_DETECTION_MIN_THRESHOLD = 0.5;

/** Main's `clearPresidio` exchange: one inline JSON POST, never staged (main never staged it). */
export class HttpPresidioChannel implements PresidioChannel {
  static create(input: { endpoint: string | undefined }): HttpPresidioChannel {
    return new HttpPresidioChannel(input.endpoint);
  }

  private constructor(private readonly endpoint: string | undefined) {}

  async detect(input: PiiDetectionRequest): Promise<PiiDetectionOutcome> {
    if (!this.endpoint) return { kind: "not_configured" };
    if (input.texts.length === 0) return { kind: "detected", results: [] };

    const response = await fetch(`${this.endpoint}${PII_DETECTION_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: input.texts.map((text) => ({ input: text })),
        settings: {
          entities: Object.fromEntries(input.entities.map((name) => [name.toLowerCase(), true])),
          min_threshold: PII_DETECTION_MIN_THRESHOLD,
        },
        env: {},
      }),
      signal: input.signal,
    });
    if (!response.ok) {
      throw new LangevalsPiiDetectionError(await response.text());
    }

    const answer: unknown = await response.json();
    const parsed = batchEvaluationResultSchema.safeParse(answer);
    if (!parsed.success || parsed.data.length !== input.texts.length) {
      throw new LangevalsPiiDetectionError(
        `Unexpected batch response: expected ${input.texts.length} results, got ${
          Array.isArray(answer) ? answer.length : "non-array"
        }`,
      );
    }

    return { kind: "detected", results: parsed.data };
  }
}
