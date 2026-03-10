import { vi } from "vitest";

import type { NormalizedAttributes, NormalizedEvent } from "../../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { SpanDataBag } from "../../spanDataBag";
import type { ExtractorContext } from "../_types";

import { parseJsonStringValues as parseJsonStringAttrs } from "../../../../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";

export { parseJsonStringAttrs };

/**
 * Creates a real ExtractorContext for extractor unit tests.
 *
 * Builds real AttributeBag / EventBag / SpanDataBag instances so extractors
 * exercise their actual production code paths, while `recordRule`, `setAttr`,
 * and `setAttrIfAbsent` are wrapped in vi.fn() for easy assertion.
 *
 * JSON-looking string values in attrs are auto-parsed to match the production
 * pipeline's `parseJsonStringValues()` step.
 */
export function createExtractorContext(
  attrs: Record<string, unknown>,
  spanOverrides?: Partial<ExtractorContext["span"]>,
  events?: NormalizedEvent[],
): ExtractorContext {
  const parsed = parseJsonStringAttrs(attrs);
  const bag = new SpanDataBag(parsed as NormalizedAttributes, events ?? []);
  const out: NormalizedAttributes = {};

  const setAttr = vi.fn((key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    out[key] = value;
  });

  const setAttrIfAbsent = vi.fn((key: string, value: unknown) => {
    if (!(key in out)) {
      if (value === null || value === undefined) return;
      out[key] = value;
    }
  });

  const recordRule = vi.fn();

  const span: ExtractorContext["span"] = {
    name: "test",
    kind: 0,
    instrumentationScope: { name: "test", version: null },
    statusMessage: null,
    statusCode: null,
    parentSpanId: "abc123",
    ...spanOverrides,
  };

  return { bag, out, span, recordRule, setAttr, setAttrIfAbsent };
}
