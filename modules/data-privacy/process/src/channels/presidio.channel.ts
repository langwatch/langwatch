import type { PiiDetectionOutcome, PiiDetectionRequest } from "@langwatch/evaluation-contract";

/**
 * langevals' Presidio analyzer, as this module reaches it: one batch per call. An empty batch
 * sends nothing and answers whether the deployment names an endpoint at all.
 */
export interface PresidioChannel {
  detect(input: PiiDetectionRequest): Promise<PiiDetectionOutcome>;
}
