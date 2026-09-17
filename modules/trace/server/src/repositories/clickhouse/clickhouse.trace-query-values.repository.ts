import { FilterParseError, type TagToken,type TranslationContext } from "@langwatch/trace-contract";

export const MAX_VALUE_LENGTH = 500;
export const MAX_ATTRIBUTE_KEY_LENGTH = 256;
const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z0-9_./:-]+$/;

/**
 * Trace-level attribute filter: two prefixes accepted for backwards compatibility.
 */
export const TRACE_ATTRIBUTE_PREFIX_LEGACY = "attribute.";
export const TRACE_ATTRIBUTE_PREFIX = "trace.attribute.";
/**
 * Prefix for event-attribute filtering via span-level subquery.
 */
export const EVENT_ATTRIBUTE_PREFIX_LEGACY = "event.";
export const EVENT_ATTRIBUTE_PREFIX = "event.attribute.";
/**
 * Prefix for span-level attribute filtering via partition-pruned subquery.
 */
export const SPAN_ATTRIBUTE_PREFIX = "span.attribute.";

// ---------------------------------------------------------------------------
// In-memory helpers (used by the field defs' `evaluateInMemory` side)
// ---------------------------------------------------------------------------

/**
 * Sanitizes values and mints parameter names for ClickHouse trace queries.
 */
export class ClickHouseTraceQueryValuesRepository {
  private constructor() {}

  static create(): ClickHouseTraceQueryValuesRepository {
    return new ClickHouseTraceQueryValuesRepository();
  }

  private escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  extractStringValue(tag: TagToken): string {
    if (tag.expression.type === "LiteralExpression") {
      return String(tag.expression.value);
    }
    if (tag.expression.type === "RegexExpression") {
      return String(tag.expression.value);
    }
    throw new FilterParseError("Unsupported value expression");
  }

  extractNumericValue(tag: TagToken): number {
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
   * Mints unique parameter names for the ClickHouse SDK to bind.
   */
  nextParam(ctx: TranslationContext, base = "f"): string {
    const name = `${base}${base === "f" ? "" : "_"}${ctx.paramCounter}`;
    ctx.paramCounter++;
    return name;
  }

  validateValueLength(value: string): void {
    if (value.length > MAX_VALUE_LENGTH) {
      throw new FilterParseError(`Filter value too long (max ${MAX_VALUE_LENGTH} characters)`);
    }
  }

  validateAttributeKey(key: string): void {
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

  wrap(sql: string, negated: boolean): string {
    return negated ? `NOT (${sql})` : sql;
  }

  /**
   * Safe own-property read to avoid prototype pollution from user-supplied keys.
   */
  readAttribute(attrs: Record<string, string>, key: string): string {
    return Object.hasOwn(attrs, key) ? (attrs[key] ?? "") : "";
  }

  /**
   * In-memory equivalent of the `LIKE` match the wildcard translators emit: the
   * SQL side turns a user `*` into `%` and does a full-string `LIKE`, so here we
   * split on `*`, escape the literal segments, and anchor the resulting regex.
   */
  likeMatch(actual: string, pattern: string): boolean {
    const regex = pattern
      .split("*")
      .map((part) => this.escapeRegExp(part))
      .join(".*");
    return new RegExp(`^${regex}$`).test(actual);
  }

  /**
   * Parses JSON-encoded string arrays from attribute values.
   */
  parseJsonStringArray(raw: string | undefined): string[] | null {
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      // Not valid JSON — treat as absent.
      return null;
    }
    return null;
  }
}
