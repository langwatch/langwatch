import type { Attributes } from "@opentelemetry/api";

/**
 * Utilities for extracting typed values from span attributes.
 *
 * @example
 * ```typescript
 * const userId = extractString(attrs, "langwatch.user.id");
 * const labels = extractStringArray(attrs, "langwatch.labels");
 * const tokenCount = extractNumber(attrs, "gen_ai.usage.input_tokens");
 * ```
 */

/**
 * Extracts a non-empty string value from attributes.
 */
const extractString = (attrs: Attributes, key: string): string | null => {
  const value = attrs[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/**
 * Extracts a string array from attributes.
 */
const extractStringArray = (attrs: Attributes, key: string): string[] => {
  const value = attrs[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
};

/**
 * Extracts a valid number from attributes.
 */
const extractNumber = (attrs: Attributes, key: string): number | null => {
  const value = attrs[key];
  return typeof value === "number" && isFinite(value) ? value : null;
};

/**
 * Extracts a positive number from attributes (useful for token counts).
 */
const extractPositiveNumber = (
  attrs: Attributes,
  key: string,
): number | null => {
  const value = extractNumber(attrs, key);
  return value !== null && value > 0 ? value : null;
};

/**
 * Extracts a boolean from attributes.
 */
const extractBoolean = (attrs: Attributes, key: string): boolean | null => {
  const value = attrs[key];
  return typeof value === "boolean" ? value : null;
};

/**
 * Extracts the first non-null string from multiple attribute keys.
 */
const extractFirstString = (
  attrs: Attributes,
  ...keys: string[]
): string | null => {
  for (const key of keys) {
    const value = extractString(attrs, key);
    if (value !== null) return value;
  }
  return null;
};

/**
 * Extracts the first non-null number from multiple attribute keys.
 */
const extractFirstNumber = (
  attrs: Attributes,
  ...keys: string[]
): number | null => {
  for (const key of keys) {
    const value = extractNumber(attrs, key);
    if (value !== null) return value;
  }
  return null;
};

export const SpanAttributeExtractionUtils = {
  extractString,
  extractStringArray,
  extractNumber,
  extractPositiveNumber,
  extractBoolean,
  extractFirstString,
  extractFirstNumber,
} as const;
