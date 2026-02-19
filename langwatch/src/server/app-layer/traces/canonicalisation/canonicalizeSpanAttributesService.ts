import type { NormalizedAttributes, NormalizedEvent } from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  FallbackExtractor,
  GenAIExtractor,
  HaystackExtractor,
  LangWatchExtractor,
  LegacyOtelTracesExtractor,
  LogfireExtractor,
  MastraExtractor,
  OpenInferenceExtractor,
  StrandsExtractor,
  TraceloopExtractor,
  VercelExtractor,
} from "./extractors";
import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
} from "./extractors/_types";
import { SpanDataBag } from "./spanDataBag";
import { toAttrValue } from "./utils";

export type CanonicalizeResult = {
  attributes: NormalizedAttributes;
  events: NormalizedEvent[];
  appliedRules: string[];
};

export class CanonicalizeSpanAttributesService {
  private readonly extractors: CanonicalAttributesExtractor[] = [
    // Priority is determined by the order of registration.
    new LangWatchExtractor(),
    new GenAIExtractor(),
    new MastraExtractor(),
    new OpenInferenceExtractor(),
    new TraceloopExtractor(),
    new VercelExtractor(),
    new StrandsExtractor(),
    new LogfireExtractor(),
    new HaystackExtractor(),
    new LegacyOtelTracesExtractor(),
    new FallbackExtractor(),
  ];

  registerExtractor(extractor: CanonicalAttributesExtractor): void {
    this.extractors.push(extractor);
  }

  /**
   * Canonicalizes attributes deterministically:
   * - AttributeBag tracks what's been consumed
   * - Extractors write canonical keys to `out`
   * - Canonical keys win on collision (merged last)
   */
  canonicalize(
    spanAttributes: NormalizedAttributes,
    events: NormalizedEvent[],
    spanForContext: ExtractorContext["span"],
  ): CanonicalizeResult {
    const bag = new SpanDataBag(spanAttributes, events);
    const out: NormalizedAttributes = {};
    const appliedRules: string[] = [];

    const recordRule = (ruleId: string) => appliedRules.push(ruleId);

    const setAttr = (key: string, value: unknown) => {
      const av = toAttrValue(value);
      if (av === null) return;
      out[key] = av;
    };

    const setAttrIfAbsent = (key: string, value: unknown) => {
      if (bag.attrs.has(key) || out[key] !== void 0) return;
      setAttr(key, value);
    };

    for (const ex of this.extractors) {
      ex.apply({
        bag,
        out,
        recordRule,
        span: spanForContext,
        setAttr,
        setAttrIfAbsent,
      });
    }

    // canonical keys win on collision
    const merged: NormalizedAttributes = {
      ...bag.attrs.remaining(),
      ...out,
    };

    return {
      attributes: merged,
      events: bag.events.remaining(),
      appliedRules,
    };
  }
}
