import type {
  NormalizedAttributes,
  NormalizedEvent,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { parseJsonStringValues } from "../../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";
import {
  ClaudeCodeExtractor,
  CodexExtractor,
  FallbackExtractor,
  GenAIExtractor,
  HaystackExtractor,
  LangWatchExtractor,
  LegacyOtelTracesExtractor,
  LogfireExtractor,
  MastraExtractor,
  OpenInferenceExtractor,
  SpringAIExtractor,
  StrandsExtractor,
  TraceloopExtractor,
  VercelExtractor,
} from "./extractors";
import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
} from "./extractors/_types";
import { SpanDataBag } from "./spanDataBag";

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
    // ClaudeCode + Codex + SpringAI register here too so their span-side
    // `apply()` runs on Path B emitters that ship native spans (codex
    // 0.137+ Rust CLI under scope `codex_cli_rs`, future ClaudeCode/
    // Spring observation spans). Today the latter two are no-ops on
    // spans; CodexExtractor lifts session_task.turn into gen_ai.*.
    new ClaudeCodeExtractor(),
    new CodexExtractor(),
    new SpringAIExtractor(),
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
    const bag = new SpanDataBag(parseJsonStringValues(spanAttributes), events);
    const out: NormalizedAttributes = {};
    const appliedRules: string[] = [];

    const recordRule = (ruleId: string) => appliedRules.push(ruleId);

    const setAttr = (key: string, value: unknown) => {
      if (value === null || value === undefined) return;
      out[key] = value;
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
