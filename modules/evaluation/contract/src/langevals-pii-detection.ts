import type { BatchEvaluationResult } from "@langwatch/evaluator-contract";

/** One batch through langevals' Presidio analyzer; the signal bounds the whole exchange. */
export type PiiDetectionRequest = Readonly<{
  /** The tenant the texts belong to; absent, the batch is never staged (main never staged it). */
  projectId?: string | undefined;
  texts: readonly string[];
  /** Analyzer entity names, any case; each is sent lowercased and switched on. */
  entities: readonly string[];
  signal: AbortSignal;
}>;

/**
 * `detected` carries one result per text, in order. `not_configured`: this
 * deployment names no langevals endpoint, so nothing was sent.
 */
export type PiiDetectionOutcome =
  | Readonly<{ kind: "detected"; results: BatchEvaluationResult }>
  | Readonly<{ kind: "not_configured" }>;

/** langevals answered a PII batch with a non-2xx or an answer that is not one result per text. */
export class LangevalsPiiDetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LangevalsPiiDetectionError";
  }
}
