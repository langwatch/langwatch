import { vi } from "vitest";

import type { CanonicalAttributes, CanonicalEvent } from "@langwatch/trace-contract";
import { parseJsonStringValues as parseJsonStringAttrs } from "../../../../services/canonical-json.rules";
import { LogRecordDataBag } from "../../../canonical-log-record.bag";
import { SpanDataBag } from "../../../canonical-span.bag";
import type {
  ExtractorContext,
  LogExtractorContext,
} from "../../../../ports/canonical-attributes.port";

export { parseJsonStringAttrs };

/**
 * Creates a real ExtractorContext for extractor unit tests.
 *
 * Builds real AttributeBag / EventBag / SpanDataBag instances so extractors
 * exercise their actual production code paths, while `recordRule`, `setAttr`,
 * and `setAttrIfAbsent` are wrapped in vi.fn() for easy assertion.
 *
 * JSON-looking string values in attrs are auto-parsed to match the production
 * pipeline's `parseJsonStringValues()` step — pass `skipJsonParsing` to feed
 * raw string values instead, exercising an extractor's own defensive
 * safeJsonParse path.
 */
export function createExtractorContext(
  attrs: Record<string, unknown>,
  spanOverrides?: Partial<ExtractorContext["span"]>,
  events?: CanonicalEvent[],
  options?: { skipJsonParsing?: boolean },
): ExtractorContext {
  const parsed = options?.skipJsonParsing ? attrs : parseJsonStringAttrs(attrs);
  const bag = new SpanDataBag(parsed as CanonicalAttributes, events ?? []);
  const out: CanonicalAttributes = {};

  const setAttr = vi.fn((key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    out[key] = value;
  });

  // Mirrors the production guard, which yields to a value the emitter already
  // sent under the canonical key as well as to one an earlier extractor wrote.
  const setAttrIfAbsent = vi.fn((key: string, value: unknown) => {
    if (bag.attrs.has(key) || key in out) return;
    if (value === null || value === undefined) return;
    out[key] = value;
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

/**
 * Creates a real LogExtractorContext for extractor.applyLog unit
 * tests. Builds a real LogRecordDataBag so extractors exercise their
 * actual production code paths; recordRule / setAttr / setAttrIfAbsent
 * are vi.fn() wrappers around an `out` bag that mirrors production
 * shape for easy assertion.
 */
export function createLogExtractorContext(
  scopeName: string,
  attrs: Record<string, unknown>,
  body = "",
): LogExtractorContext {
  const parsed = parseJsonStringAttrs(attrs);
  const bag = new LogRecordDataBag(scopeName, body, parsed as CanonicalAttributes);
  const out: CanonicalAttributes = {};

  const setAttr = vi.fn((key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    out[key] = value;
  });

  // Mirrors the production guard, which yields to a value the emitter already
  // sent under the canonical key as well as to one an earlier extractor wrote.
  const setAttrIfAbsent = vi.fn((key: string, value: unknown) => {
    if (bag.attrs.has(key) || key in out) return;
    if (value === null || value === undefined) return;
    out[key] = value;
  });

  const recordRule = vi.fn();

  return { bag, out, recordRule, setAttr, setAttrIfAbsent };
}
