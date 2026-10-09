import type { PiiDetectionOutcome, PiiDetectionRequest } from "@langwatch/evaluation-contract";

import type { PresidioChannel } from "../presidio.channel.ts";

/** Records every batch and answers from a scripted queue; an empty queue refuses by name. */
export class MemoryPresidioChannel implements PresidioChannel {
  static create(input: { endpoint?: string | undefined } = {}): MemoryPresidioChannel {
    return new MemoryPresidioChannel(input.endpoint !== undefined);
  }

  readonly batches: PiiDetectionRequest[] = [];
  readonly #answers: PiiDetectionOutcome[] = [];

  private constructor(private readonly configured: boolean) {}

  answerWith(outcome: PiiDetectionOutcome): void {
    this.#answers.push(outcome);
  }

  async detect(input: PiiDetectionRequest): Promise<PiiDetectionOutcome> {
    this.batches.push(input);
    if (!this.configured) return { kind: "not_configured" };
    if (input.texts.length === 0) return { kind: "detected", results: [] };
    const answer = this.#answers.shift();
    if (!answer) throw new Error("no scripted Presidio answer");
    return answer;
  }
}
