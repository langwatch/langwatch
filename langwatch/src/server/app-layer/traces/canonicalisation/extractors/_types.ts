/**
 * Extractor Type Definitions
 *
 * This module defines the core types used by the canonicalization extractor
 * system, including the ExtractorContext and CanonicalAttributesExtractor
 * interface.
 */

import type {
  NormalizedAttributes,
  NormalizedSpan,
} from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import type { LogRecordDataBag } from "../logRecordDataBag";
import type { SpanDataBag } from "../spanDataBag";

/**
 * Context provided to each extractor during canonicalization.
 *
 * @property bag - Access to unconsumed attributes and events
 * @property out - Output attributes map (canonical attributes)
 * @property span - Span metadata for context
 * @property recordRule - Record that a rule was applied
 * @property setAttr - Set an output attribute
 * @property setAttrIfAbsent - Set an output attribute only if not already set
 */
export type ExtractorContext = {
  bag: SpanDataBag;
  out: NormalizedAttributes;
  span: Pick<
    NormalizedSpan,
    | "name"
    | "kind"
    | "instrumentationScope"
    | "statusMessage"
    | "statusCode"
    | "parentSpanId"
  >;

  recordRule: (ruleId: string) => void;
  setAttr: (key: string, value: unknown) => void;
  setAttrIfAbsent: (key: string, value: unknown) => void;
};

/**
 * Context provided to each extractor when canonicalising a log
 * record (the receiver-side /v1/logs path). Mirrors ExtractorContext
 * but the bag holds log-record attributes + scopeName + body
 * instead of a span. Used by extractors that implement `applyLog`
 * to lift cost / tokens / model / I/O off platform-tool log events
 * (claude_code.api_request, codex.sse_event, gen_ai.* logs).
 */
export type LogExtractorContext = {
  bag: LogRecordDataBag;
  out: NormalizedAttributes;
  recordRule: (ruleId: string) => void;
  setAttr: (key: string, value: unknown) => void;
  setAttrIfAbsent: (key: string, value: unknown) => void;
};

export interface CanonicalAttributesExtractor {
  /** Stable ID for debugging / tests */
  readonly id: string;

  /**
   * Apply canonicalization rules to a SPAN.
   * Extractors should:
   * - read from bag (prefer take() for keys they "own")
   * - write canonical keys to out
   * - call recordRule when they actually did something
   */
  apply(ctx: ExtractorContext): void;

  /**
   * Apply canonicalization rules to a LOG RECORD. Optional — only
   * extractors whose source emits log records implement this
   * (ClaudeCode, Codex, GenAI for the gemini-style emitters,
   * SpringAI). Receiver-side log path iterates all extractors
   * and invokes `applyLog` where present. Span-side `apply` is
   * still called for spans; the two are independent.
   */
  applyLog?(ctx: LogExtractorContext): void;
}

export const setIfDefined = (
  out: NormalizedAttributes,
  key: string,
  value: unknown,
): void => {
  if (value === null || value === void 0) return;
  out[key] = value as NormalizedAttributes[string];
};
