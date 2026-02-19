import { vi } from "vitest";

import type { NormalizedAttributes } from "../../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { SpanDataBag } from "../../spanDataBag";
import type { ExtractorContext } from "../_types";

/**
 * Creates a real ExtractorContext for extractor unit tests.
 *
 * Builds real AttributeBag / EventBag / SpanDataBag instances so extractors
 * exercise their actual production code paths, while `recordRule`, `setAttr`,
 * and `setAttrIfAbsent` are wrapped in vi.fn() for easy assertion.
 */
export function createExtractorContext(
  attrs: Record<string, unknown>,
  spanOverrides?: Partial<ExtractorContext["span"]>,
): ExtractorContext {
  const bag = new SpanDataBag(attrs as NormalizedAttributes, []);
  const out: NormalizedAttributes = {};

  const setAttr = vi.fn((key: string, value: unknown) => {
    out[key] = value as NormalizedAttributes[string];
  });

  const setAttrIfAbsent = vi.fn((key: string, value: unknown) => {
    if (!(key in out)) {
      out[key] = value as NormalizedAttributes[string];
    }
  });

  const recordRule = vi.fn();

  const span: ExtractorContext["span"] = {
    name: "test",
    kind: 0,
    instrumentationScope: { name: "test", version: null },
    statusMessage: null,
    statusCode: null,
    ...spanOverrides,
  };

  return { bag, out, span, recordRule, setAttr, setAttrIfAbsent };
}
