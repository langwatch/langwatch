import type { NormalizedAttributes, NormalizedSpan } from "../../schemas/spans";
import type { SpanDataBag } from "../spanDataBag";

export type ExtractorContext = {
  bag: SpanDataBag;
  out: NormalizedAttributes;
  span: Pick<
    NormalizedSpan,
    "name" | "kind" | "instrumentationScope" | "statusMessage" | "statusCode"
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
