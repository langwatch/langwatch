/**
 * Driver that runs the canonical extractor registry against a log
 * record received event. Mirrors the span-side canonicalisation
 * pipeline but for log records, replacing the three bespoke
 * extract*FromLogRecord helpers that previously lived in
 * trace-io-accumulation.service.ts.
 *
 * Adding a new platform-tool to the log lift is a one-line addition
 * to the registry below + a new extractor class under
 * canonicalisation/extractors/.
 */

import { LogRecordDataBag } from "../../../../../app-layer/traces/canonicalisation/logRecordDataBag";
import {
  ClaudeCodeExtractor,
  CodexExtractor,
  GenAIExtractor,
  SpringAIExtractor,
} from "../../../../../app-layer/traces/canonicalisation/extractors";
import type {
  CanonicalAttributesExtractor,
  LogExtractorContext,
} from "../../../../../app-layer/traces/canonicalisation/extractors/_types";
import type { NormalizedAttributes } from "../../schemas/spans";
import type { LogRecordReceivedEventData } from "../../schemas/events";

const LOG_EXTRACTORS: readonly CanonicalAttributesExtractor[] = [
  new ClaudeCodeExtractor(),
  new CodexExtractor(),
  new GenAIExtractor(),
  new SpringAIExtractor(),
];

/**
 * Runs every registered extractor's `applyLog` against the log
 * record and returns the canonical attributes they collectively
 * lifted. The result is intended to be merged into the trace
 * summary's `attributes` map — caller decides write semantics
 * (overwrite vs setIfAbsent vs reserved-key carve-outs).
 *
 * Extractors that don't implement `applyLog` are skipped. Extractors
 * that find no matching scope/event return without writing.
 */
export function liftCanonicalAttributesFromLogRecord(
  data: LogRecordReceivedEventData,
): NormalizedAttributes {
  const bag = new LogRecordDataBag(
    data.scopeName,
    data.body,
    data.attributes as NormalizedAttributes,
  );
  const out: NormalizedAttributes = {};

  const ctx: LogExtractorContext = {
    bag,
    out,
    recordRule: () => {
      /* receiver-side: no rule sink today; reserved for future audit */
    },
    setAttr: (key: string, value: unknown) => {
      if (value === null || value === undefined) return;
      out[key] = value as NormalizedAttributes[string];
    },
    setAttrIfAbsent: (key: string, value: unknown) => {
      if (key in out) return;
      if (value === null || value === undefined) return;
      out[key] = value as NormalizedAttributes[string];
    },
  };

  for (const extractor of LOG_EXTRACTORS) {
    extractor.applyLog?.(ctx);
  }

  return out;
}
