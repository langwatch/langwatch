import type { PiiDetectionOutcome, PiiDetectionRequest } from "@langwatch/evaluation-contract";

import type { ModelCallContext } from "../rules/pii-redaction-model.rules.ts";

/**
 * langevals' Presidio analyzer, as this module reaches it: one batch per call. An empty batch
 * sends nothing and answers whether the deployment names an endpoint at all.
 */
export interface PresidioChannel {
  detect(input: PiiDetectionRequest): Promise<PiiDetectionOutcome>;
}

/**
 * A channel that takes split calls (ADR-207): each call runs on its own, so the pieces of a long
 * span never queue in front of short ones. Only the model's Lambda channel is one.
 */
export interface SplittingPresidioChannel extends PresidioChannel {
  readonly splits: true;
  detect(
    input: PiiDetectionRequest,
    options?: { context: ModelCallContext },
  ): Promise<PiiDetectionOutcome>;
}

export function canSplit(channel: PresidioChannel): channel is SplittingPresidioChannel {
  return "splits" in channel && channel.splits === true;
}
