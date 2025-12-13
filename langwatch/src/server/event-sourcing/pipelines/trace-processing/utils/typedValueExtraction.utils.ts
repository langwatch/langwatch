import type { OpenTelemetryGenAIMessage } from "../schemas/messageSchemas";
import type { SpanData } from "../schemas/commands";
import { pipe } from "fp-ts/function";
import { match } from "ts-pattern";
import { Result, ok, err } from "neverthrow";

/**
 * Typed value representing different input/output formats.
 * Reconstructed from OTEL GenAI attributes stored in SpanData.
 */
export type TypedValue =
  | { type: "text"; value: string }
  | { type: "chat_messages"; value: OpenTelemetryGenAIMessage[] }
  | { type: "json"; value: unknown }
  | { type: "raw"; value: unknown };

/**
 * Utilities for extracting typed values from span attributes.
 * Handles both LLM spans (gen_ai.* attributes) and non-LLM spans (langwatch.* attributes).
 * Uses Result types for safe JSON parsing.
 *
 * @example
 * ```typescript
 * const input = extractTypedValueFromSpan(span, "input");
 * const output = extractTypedValueFromSpan(span, "output");
 * ```
 */

/**
 * Safely parses JSON string, returning a Result type.
 */
const safeJsonParse = (value: string): Result<unknown, Error> => {
  try {
    return ok(JSON.parse(value));
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

/**
 * Creates a TypedValue from a parsed JSON value.
 */
const createTypedValueFromParsed = (
  parsed: unknown,
  fallbackText: string,
): TypedValue => {
  return match(parsed)
    .when(Array.isArray, (arr) => ({
      type: "chat_messages" as const,
      value: arr,
    }))
    .when(
      (val) => val && typeof val === "object" && "type" in val,
      (val) => val as TypedValue,
    )
    .otherwise(() => ({ type: "json" as const, value: parsed }));
};

/**
 * Extracts typed value from a string attribute value.
 */
const extractTypedValueFromString = (attrValue: string): TypedValue => {
  return pipe(safeJsonParse(attrValue), (result) =>
    result.match(
      (parsed) => createTypedValueFromParsed(parsed, attrValue),
      () => ({ type: "text" as const, value: attrValue }),
    ),
  );
};

/**
 * Extracts a non-empty string from attributes.
 */
const extractNonEmptyString = (
  attributes: SpanData["attributes"],
  key: string,
): string | null => {
  const value = attributes[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
};

/**
 * Extracts typed value (input or output) from span attributes.
 * - LLM spans: read from gen_ai.input.messages / gen_ai.output.messages
 * - Non-LLM spans: read from langwatch.input / langwatch.output
 * - No fallback logic (clean break)
 *
 * @param span - The span to extract from
 * @param field - "input" or "output"
 * @returns The extracted typed value, or null if not found
 *
 * @example
 * ```typescript
 * const input = extractTypedValueFromSpan(span, "input");
 * if (input) {
 *   console.log(input.type, input.value);
 * }
 * ```
 */
function extractTypedValueFromSpan(
  span: SpanData,
  field: "input" | "output",
): TypedValue | null {
  const spanType = span.attributes["langwatch.span.type"];

  return match(spanType)
    .with("llm", () => {
      const attrKey =
        field === "input" ? "gen_ai.input.messages" : "gen_ai.output.messages";
      const attrValue = extractNonEmptyString(span.attributes, attrKey);
      return attrValue ? extractTypedValueFromString(attrValue) : null;
    })
    .otherwise(() => {
      const langwatchKey = `langwatch.${field}`;
      const langwatchValue = extractNonEmptyString(
        span.attributes,
        langwatchKey,
      );
      return langwatchValue
        ? extractTypedValueFromString(langwatchValue)
        : null;
    });
}

export { extractTypedValueFromSpan };

export const TypedValueExtractionUtils = {
  extractTypedValueFromSpan,
} as const;
