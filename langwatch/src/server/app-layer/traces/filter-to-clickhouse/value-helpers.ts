import type { TagToken } from "liqe";
import { FilterParseError } from "../errors";

export const MAX_VALUE_LENGTH = 500;
export const MAX_ATTRIBUTE_KEY_LENGTH = 256;
const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z0-9_./:-]+$/;

/**
 * Trace-level attribute filter: matches `Attributes[<key>]` on `trace_summaries`.
 * Two prefixes accepted — the legacy `attribute.<key>` and the namespaced
 * `trace.attribute.<key>` form. Both translate to the same SQL. The namespaced
 * form is the preferred surface (root-prefix is unique), but old saved queries
 * keep working without a migration.
 */
export const TRACE_ATTRIBUTE_PREFIX_LEGACY = "attribute.";
export const TRACE_ATTRIBUTE_PREFIX = "trace.attribute.";
/**
 * Prefix for event-attribute filtering. Drills into per-event
 * `Events.Attributes` maps via a span-level subquery (event attributes live
 * on spans, not on the trace summary). `event.attribute.<key>` is the
 * canonical surface; `event.<key>` is kept as an alias so old saved queries
 * still work, distinguishing it from the bare `event:<name>` filter that
 * matches `Events.Name`.
 */
export const EVENT_ATTRIBUTE_PREFIX_LEGACY = "event.";
export const EVENT_ATTRIBUTE_PREFIX = "event.attribute.";
/**
 * Prefix for span-level attribute filtering: `span.attribute.<key>:value`.
 * Drills into `stored_spans.SpanAttributes` via a partition-pruned
 * `arrayExists`/map-lookup subquery — the trace summary doesn't carry
 * arbitrary span attrs, but the per-span row does. Same shape as the
 * event-attribute filter.
 */
export const SPAN_ATTRIBUTE_PREFIX = "span.attribute.";

export interface TranslationContext {
  paramCounter: number;
  nodeCount: number;
  params: Record<string, unknown>;
  tenantId: string;
  timeRange: { from: number; to: number };
}

export type FieldHandler = (
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
) => string;

export function extractStringValue(tag: TagToken): string {
  if (tag.expression.type === "LiteralExpression") {
    return String(tag.expression.value);
  }
  if (tag.expression.type === "RegexExpression") {
    return String(tag.expression.value);
  }
  throw new FilterParseError("Unsupported value expression");
}

export function extractNumericValue(tag: TagToken): number {
  if (tag.expression.type !== "LiteralExpression") {
    throw new FilterParseError("Expected a numeric value");
  }
  const raw = tag.expression.value;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (Number.isNaN(num)) {
    throw new FilterParseError(`Not a number: ${String(raw)}`);
  }
  return num;
}

/**
 * Generate a unique parameter name for the ClickHouse SDK to bind. Pass a
 * semantic `base` (e.g. `"traceId"`) so the resulting query reads naturally —
 * `WHERE TraceId = {traceId_0:String}` instead of `{f0:String}`. The trailing
 * counter keeps names unique when the same field appears multiple times in
 * one query.
 */
export function nextParam(ctx: TranslationContext, base = "f"): string {
  const name = `${base}${base === "f" ? "" : "_"}${ctx.paramCounter}`;
  ctx.paramCounter++;
  return name;
}

export function validateValueLength(value: string): void {
  if (value.length > MAX_VALUE_LENGTH) {
    throw new FilterParseError(
      `Filter value too long (max ${MAX_VALUE_LENGTH} characters)`,
    );
  }
}

export function validateAttributeKey(key: string): void {
  if (key.length === 0) {
    throw new FilterParseError("Attribute key cannot be empty");
  }
  if (key.length > MAX_ATTRIBUTE_KEY_LENGTH) {
    throw new FilterParseError(
      `Attribute key too long (max ${MAX_ATTRIBUTE_KEY_LENGTH} characters)`,
    );
  }
  if (!ATTRIBUTE_KEY_PATTERN.test(key)) {
    throw new FilterParseError(
      "Attribute key contains invalid characters — use letters, digits, '.', '_', '-', '/' or ':'",
    );
  }
}

export function wrap(sql: string, negated: boolean): string {
  return negated ? `NOT (${sql})` : sql;
}
