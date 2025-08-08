import { z } from "zod";
import {
  chatMessageSchema,
  spanInputOutputSchema,
} from "../../internal/generated/types/tracer.generated";
import { type ChatMessage, type SpanInputOutput } from "../../internal/generated/types/tracer";
import { type JsonSerializable } from "./types";

/**
 * Valid input/output types for span data
 */
export const INPUT_OUTPUT_TYPES = [
  "text",
  "raw",
  "chat_messages",
  "list",
  "json",
  "guardrail_result",
  "evaluation_result"
] as const;

export type InputOutputType = typeof INPUT_OUTPUT_TYPES[number];

/**
 * Simple type checks for common input/output types
 */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!isObject(value)) return false;
  return (
    typeof value.role === "string" &&
    (typeof value.content === "string" || value.content === null || value.content === undefined)
  );
}

function isChatMessageArray(value: unknown): value is ChatMessage[] {
  return Array.isArray(value) && value.every(isChatMessage);
}

/**
 * Converts any value to a SpanInputOutput format with soft validation.
 * Never throws errors, always returns a valid SpanInputOutput.
 */
function convertToSpanInputOutput(value: unknown): SpanInputOutput {
  try {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return spanInputOutputSchema.parse({ type: "json", value: null });
    }

    // Handle strings
    if (isString(value)) {
      return spanInputOutputSchema.parse({ type: "text", value });
    }

    // Handle chat messages (single message)
    if (isChatMessage(value)) {
      return spanInputOutputSchema.parse({
        type: "chat_messages",
        value: [value]
      });
    }

    // Handle arrays
    if (Array.isArray(value)) {
      // Check if it's an array of chat messages
      if (value.length > 0 && isChatMessageArray(value)) {
        return spanInputOutputSchema.parse({
          type: "chat_messages",
          value
        });
      }

      // Otherwise convert to list type
      return spanInputOutputSchema.parse({
        type: "list",
        value: value.map(item => convertToSpanInputOutput(item))
      });
    }

    // Try to parse as JSON
    try {
      JSON.stringify(value);
      return spanInputOutputSchema.parse({ type: "json", value });
    } catch {
      // If value can't be serialized, convert to string
      return spanInputOutputSchema.parse({ type: "text", value: String(value) });
    }
  } catch {
    // Ultimate fallback - if any Zod validation fails, return as text
    return { type: "text", value: String(value) } as SpanInputOutput;
  }
}

/**
 * Type guard to check if a value is a valid input/output type
 */
export function isValidInputOutputType(type: string): type is InputOutputType {
  return INPUT_OUTPUT_TYPES.includes(type as InputOutputType);
}

/**
 * Validates a value for a specific input/output type using Zod schemas
 */
function validateValueForInputOutputType(type: InputOutputType, value: unknown): unknown {
  switch (type) {
    case "text":
    case "raw":
      const stringResult = z.string().safeParse(value);
      return stringResult.success ? stringResult.data : String(value);

    case "chat_messages":
      if (!Array.isArray(value)) {
        value = [value];
      }
      const chatResult = z.array(chatMessageSchema).safeParse(value);
      return chatResult.success ? chatResult.data : [{ role: "user", content: String(value) }];

    case "list":
      const listResult = z.array(spanInputOutputSchema).safeParse(value);
      return listResult.success ? listResult.data : [{ type: "text", value: String(value) }];

    case "json":
      // For JSON, we accept any serializable value
      try {
        JSON.stringify(value);
        return value;
      } catch {
        return String(value);
      }

    default:
      return value;
  }
}

/**
 * Processes input/output values for span storage with soft Zod validation.
 * Never throws errors, always returns a valid SpanInputOutput.
 *
 * @param typeOrValue - Either the explicit type string or the value to auto-detect
 * @param value - The value when explicit type is provided
 * @returns A valid SpanInputOutput object ready for span storage
 */
export function processSpanInputOutput(
  typeOrValue: string | unknown,
  value?: unknown
): SpanInputOutput {
  try {
    // If explicit type is provided
    if (typeof typeOrValue === "string" && value !== undefined) {
      const type = isValidInputOutputType(typeOrValue) ? typeOrValue : "json";
      const validatedValue = validateValueForInputOutputType(type, value);

      // Final validation with spanInputOutputSchema
      const result = spanInputOutputSchema.safeParse({ type, value: validatedValue });
      return result.success ? result.data : { type: "raw", value: String(validatedValue) };
    }

    // Auto-detect type
    return convertToSpanInputOutput(typeOrValue);
  } catch {
    // Ultimate fallback - if any validation fails, return as text
    return { type: "text", value: String(typeOrValue) } as SpanInputOutput;
  }
}

/**
 * Type-safe method signature for span input/output processing
 */
export type SpanInputOutputMethod<T> = {
  (type: "text", value: string): T;
  (type: "raw", value: string): T;
  (type: "chat_messages", value: ChatMessage[]): T;
  (type: "list", value: SpanInputOutput[]): T;
  (type: "json", value: JsonSerializable): T;
  (value: unknown): T;
}
