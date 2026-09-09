import { FilterParseError, type TagToken } from "@langwatch/trace-contract";
import type { TranslationContext } from "@langwatch/trace-contract";

export const MAX_VALUE_LENGTH = 500;
export const MAX_ATTRIBUTE_KEY_LENGTH = 256;
const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z0-9_./:-]+$/;

/**
 * Trace-level attribute filter: matches Attributes[<key>] on trace_summaries. Two prefixes accepted (legacy attribute.<key>, namespaced trace.attribute.<key>) translating to the same SQL — namespaced is preferred (unique root-prefix), but old saved queries keep working unmigrated.
 */
export const TRACE_ATTRIBUTE_PREFIX_LEGACY = "attribute.";
export const TRACE_ATTRIBUTE_PREFIX = "trace.attribute.";
/**
 * Prefix for event-attribute filtering: drills into per-event Events.Attributes via a span-level subquery (event attributes live on spans, not the trace summary). event.attribute.<key> is canonical; event.<key> is a back-compat alias, distinct from the bare event:<name> filter matching Events.Name.
 */
export const EVENT_ATTRIBUTE_PREFIX_LEGACY = "event.";
export const EVENT_ATTRIBUTE_PREFIX = "event.attribute.";
/**
 * Prefix for span-level attribute filtering: span.attribute.<key>:value, drilling into stored_spans.SpanAttributes via a partition-pruned arrayExists/map-lookup subquery — the trace summary doesn't carry arbitrary span attrs, the per-span row does. Same shape as the event-attribute filter.
 */
export const SPAN_ATTRIBUTE_PREFIX = "span.attribute.";

// ---------------------------------------------------------------------------
// In-memory helpers (used by the field defs' `evaluateInMemory` side)
// ---------------------------------------------------------------------------

/**
 * Values and parameters on their way into a CH trace query — the leaf of the translator, knowing nothing about fields/tables/filters, only how to make a value safe to bind. nextParam mints placeholder names so a value is never interpolated into SQL; validateValueLength/validateAttributeKey refuse before that happens.
 */
export class TraceQueryValuesAdapter {
  static create(): TraceQueryValuesAdapter {
    return new TraceQueryValuesAdapter();
  }

  private static escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  static extractStringValue(tag: TagToken): string {
    if (tag.expression.type === "LiteralExpression") {
      return String(tag.expression.value);
    }
    if (tag.expression.type === "RegexExpression") {
      return String(tag.expression.value);
    }
    throw new FilterParseError("Unsupported value expression");
  }

  static extractNumericValue(tag: TagToken): number {
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
   * Unique parameter name for the CH SDK to bind. Pass a semantic base ("traceId") so the query reads naturally (WHERE TraceId = {traceId_0:String}, not {f0:String}); the trailing counter keeps names unique when a field repeats in one query.
   */
  static nextParam(ctx: TranslationContext, base = "f"): string {
    const name = `${base}${base === "f" ? "" : "_"}${ctx.paramCounter}`;
    ctx.paramCounter++;
    return name;
  }

  static validateValueLength(value: string): void {
    if (value.length > MAX_VALUE_LENGTH) {
      throw new FilterParseError(`Filter value too long (max ${MAX_VALUE_LENGTH} characters)`);
    }
  }

  static validateAttributeKey(key: string): void {
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

  static wrap(sql: string, negated: boolean): string {
    return negated ? `NOT (${sql})` : sql;
  }

  /**
   * Own-property read of an attribute map, mirroring CH's Attributes[<key>] (own keys only, '' when absent). Filter keys are user-supplied, so a bare attrs[key] would resolve constructor/toString/__proto__ off Object.prototype — not cosmetic: has:attribute.constructor read (attrs[key]??"")!=="" as true on every trace while the compiled Attributes['constructor']!='' matched none.
   */
  static readAttribute(attrs: Record<string, string>, key: string): string {
    return Object.hasOwn(attrs, key) ? (attrs[key] ?? "") : "";
  }

  /**
   * In-memory equivalent of the `LIKE` match the wildcard translators emit: the
   * SQL side turns a user `*` into `%` and does a full-string `LIKE`, so here we
   * split on `*`, escape the literal segments, and anchor the resulting regex.
   */
  static likeMatch(actual: string, pattern: string): boolean {
    const regex = pattern
      .split("*")
      .map((part) => TraceQueryValuesAdapter.escapeRegExp(part))
      .join(".*");
    return new RegExp(`^${regex}$`).test(actual);
  }

  /**
   * Parses a JSON-encoded string array on Attributes (langwatch.labels/prompt_ids), mirroring the trigger matcher's parseJsonArray. JSON.parse already strips the quotes the SQL side trims with trim(BOTH '"' FROM …). Returns null for absent/malformed values.
   */
  static parseJsonStringArray(raw: string | undefined): string[] | null {
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      // Not valid JSON — treat as absent.
    }
    return null;
  }
}
