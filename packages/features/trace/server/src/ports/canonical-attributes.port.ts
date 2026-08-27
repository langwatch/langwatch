import type { CanonicalAttributes, CanonicalSpanContext } from "@langwatch/trace-contract";
import type { LogRecordDataBag } from "../stores/canonical-log-record.bag";
import type { SpanDataBag } from "../stores/canonical-span.bag";

/** Span input and output shared by canonicalisation extractors. */
export type ExtractorContext = {
  bag: SpanDataBag;
  out: CanonicalAttributes;
  span: CanonicalSpanContext;

  recordRule: (ruleId: string) => void;
  setAttr: (key: string, value: unknown) => void;
  setAttrIfAbsent: (key: string, value: unknown) => void;
};

/** Log input and output for extractors that support receiver-side logs. */
export type LogExtractorContext = {
  bag: LogRecordDataBag;
  out: CanonicalAttributes;
  recordRule: (ruleId: string) => void;
  setAttr: (key: string, value: unknown) => void;
  setAttrIfAbsent: (key: string, value: unknown) => void;
};

export abstract class CanonicalAttributesPort {
  abstract readonly id: string;

  /** Span canonicalisation. Extractors consume owned bag values and record rules. */
  abstract apply(ctx: ExtractorContext): void;

  /** Optional log canonicalisation; span and log passes remain independent. */
  abstract applyLog?(ctx: LogExtractorContext): void;
}
