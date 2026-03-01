/**
 * Extractor Type Definitions
 *
 * This module defines the core types used by the canonicalization extractor
 * system, including the ExtractorContext and CanonicalAttributesExtractor
 * interface.
 */

import type { NormalizedAttributes, NormalizedSpan } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
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

export interface CanonicalAttributesExtractor {
  /** Stable ID for debugging / tests */
  readonly id: string;

  /**
   * Apply canonicalization rules.
   * Extractors should:
   * - read from bag (prefer take() for keys they “own”)
   * - write canonical keys to out
   * - call recordRule when they actually did something
   */
  apply(ctx: ExtractorContext): void;
}

export const setIfDefined = (
  out: NormalizedAttributes,
  key: string,
  value: unknown,
): void => {
  if (value === null || value === void 0) return;
  out[key] = value as NormalizedAttributes[string];
};
