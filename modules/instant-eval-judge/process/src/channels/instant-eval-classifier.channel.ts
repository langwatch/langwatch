/**
 * The cloud classifier the judge owns (ADR-174 decision 13). `classify` answers or skips; it
 * throws only when the classifier itself is unusable, which refuses the whole query.
 * @see modules/instant-eval/specs/classifier.feature
 */

import type {
  InstantEvalJudgement,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { Secret } from "@langwatch/secrets";

/** LangWatch's own classifier key, read on LangWatch Cloud only; elsewhere nothing classifies. */
export const classifierApiKey = Secret.load("JEV_API_KEY", { optional: true });

export interface InstantEvalClassifyRequest {
  /** Names the share of the rate this request draws on; the classifier never sees it. */
  readonly projectId: string;
  /** Not pre-cut: only the classifier knows what its questions cost, so it cuts to its budget. */
  readonly text: string;
  /** Every question about that text, asked in one request. */
  readonly questions: readonly InstantEvalQuestion[];
  /** Paces each send; the service owns it, over the module's own buckets. */
  readonly limiter: InstantEvalRateLimiter;
}

export interface InstantEvalClassifierChannel {
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
export interface InstantEvalRateLimiter {
  acquire(permit: InstantEvalPermit, signal?: AbortSignal): Promise<void>;
}
