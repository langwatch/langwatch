/**
 * The judge behind a judged column. `classify` answers or skips; it throws
 * only when the judge itself is unusable, which refuses the whole query.
 * @see specs/instant-evals/classifier.feature
 */

import type {
  InstantEvalClassifierLimits,
  InstantEvalJudgement,
  InstantEvalPricing,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-contract";

export interface InstantEvalClassifyRequest {
  /**
   * The project the text is judged for — not for the judgement, which never
   * sees it, but for the rate: it names the share of the ceiling this request
   * draws on.
   */
  readonly projectId: string;
  /**
   * The text to judge, as long as the caller has it. Deliberately not pre-cut:
   * only the judge knows what its own questions cost, so it cuts to its budget
   * and reports having done so.
   */
  readonly text: string;
  /** Every question about that text, asked in one request. */
  readonly questions: readonly InstantEvalQuestion[];
}

export interface InstantEvalJudgeChannel {
  readonly limits: InstantEvalClassifierLimits;
  readonly pricing: InstantEvalPricing;
  classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement>;
  /** Releases the transport, where the implementation holds one. */
  close?(): Promise<void>;
}

/** What one classification asks the limiter for. */
export interface InstantEvalPermit {
  /** Estimated input tokens the request will send, text and questions. */
  readonly tokens: number;
  /** The project whose share of the rate the request draws on. */
  readonly tenantId: string;
}

/**
 * Take the tokens a request needs, or wait until they are there. One method
 * deliberately: everything above cares about being allowed to send, not about
 * how many tokens are left.
 */
export interface InstantEvalRateLimiterChannel {
  acquire(permit: InstantEvalPermit, signal?: AbortSignal): Promise<void>;
}
