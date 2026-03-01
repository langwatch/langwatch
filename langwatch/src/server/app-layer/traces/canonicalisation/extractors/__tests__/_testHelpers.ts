import { vi } from "vitest";

import type { NormalizedAttributes } from "../../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { SpanDataBag } from "../../spanDataBag";
import type { ExtractorContext } from "../_types";

/**
 * Parses JSON-looking string values in attrs, matching the production
 * pipeline's `parseJsonStringValues()` step that runs before canonicalization.
 */
export function parseJsonStringAttrs(
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string") {
      result[key] = value;
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      result[key] = value;
      continue;
    }
    const looksJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));
    if (!looksJson) {
      result[key] = value;
      continue;
    }
    try {
      result[key] = JSON.parse(trimmed);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

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
): ExtractorContext {
  const parsed = parseJsonStringAttrs(attrs);
  const bag = new SpanDataBag(parsed as NormalizedAttributes, []);
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
