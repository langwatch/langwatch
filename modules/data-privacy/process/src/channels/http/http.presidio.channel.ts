import {
  LangevalsPiiDetectionError,
  type PiiDetectionOutcome,
  type PiiDetectionRequest,
} from "@langwatch/evaluation-contract";

import {
  PII_DETECTION_PATH,
  presidioDetectionBody,
  readPresidioDetectionAnswer,
} from "../../rules/presidio-exchange.rules.ts";
import type { PresidioChannel } from "../presidio.channel.ts";

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
      body: presidioDetectionBody(input),
      signal: input.signal,
    });
    if (!response.ok) {
      throw new LangevalsPiiDetectionError(await response.text());
    }

    const answer: unknown = await response.json();
    return {
      kind: "detected",
      results: readPresidioDetectionAnswer({ answer, expected: input.texts.length }),
    };
  }
}
