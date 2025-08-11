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

    // Handle objects (fallback to json type)
    if (isObject(value)) {
      try {
        return spanInputOutputSchema.parse({ type: "json", value });
      } catch {
        // If json type fails, fall back to text with a safe string representation
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return spanInputOutputSchema.parse({ type: "text", value: String(value) });
      }
    }

    // Ultimate fallback for any other type
    const fallbackValue = typeof value === 'object' && value !== null
      ? `[${typeof value}]`
      // This is the only way to get a string representation of the object
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      : String(value);
    return spanInputOutputSchema.parse({ type: "text", value: fallbackValue });
  } catch {
    // Ultimate fallback - if any Zod validation fails, return as text
    const fallbackValue = typeof value === 'object' && value !== null
      ? `[${typeof value}]`
      : String(value);
    return { type: "text", value: fallbackValue } as SpanInputOutput;
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
    case "chat_messages": {
      if (!Array.isArray(value)) {
        value = [value];
      }
      const chatResult = z.array(chatMessageSchema).safeParse(value);
      const safeValue = typeof value === 'object' && value !== null
        ? `[${typeof value}]`
        : String(value);
      return chatResult.success ? chatResult.data : [{ role: "user", content: safeValue }];
    }

    case "list": {
      const listResult = z.array(spanInputOutputSchema).safeParse(value);
      const safeValue = typeof value === 'object' && value !== null
        ? `[${typeof value}]`
        : String(value);
      return listResult.success ? listResult.data : [{ type: "text", value: safeValue }];
    }

    case "json": {
      // For JSON, we accept any serializable value
      try {
        JSON.stringify(value);
        return value;
      } catch {
        const safeValue = typeof value === 'object' && value !== null
          ? `[${typeof value}]`
          : String(value);
        return safeValue;
      }
    }

    case "text":
    case "raw": {
      const stringResult = z.string().safeParse(value);
      const safeValue = typeof value === 'object' && value !== null
        ? `[${typeof value}]`
        : String(value);
      return stringResult.success ? stringResult.data : safeValue;
    }

    default:
      return value;
  }
}

/**
 * Processes input/output values for span storage with soft Zod validation.
 * Never throws errors, always returns a valid SpanInputOutput.
 * When a type is explicitly provided, it will be preferred over auto-detection.
 *
 * @param typeOrValue - Either the explicit type string or the value to auto-detect
 * @param value - The value when explicit type is provided
 * @returns A valid SpanInputOutput object ready for span storage
 */
export function processSpanInputOutput(
  typeOrValue: unknown,
  value?: unknown
): SpanInputOutput {
  try {
    // If explicit type is provided, prefer it over auto-detection
    if (typeof typeOrValue === "string" && value !== undefined) {
      const type = isValidInputOutputType(typeOrValue) ? typeOrValue : "json";
      const validatedValue = validateValueForInputOutputType(type, value);

      // Final validation with spanInputOutputSchema
      const result = spanInputOutputSchema.safeParse({ type, value: validatedValue });
      const safeValue = typeof validatedValue === 'object' && validatedValue !== null
        ? `[${typeof validatedValue}]`
        : String(validatedValue);
      return result.success ? result.data : { type: "raw", value: safeValue };
    }

    // Auto-detect type when no explicit type is provided
    return convertToSpanInputOutput(typeOrValue);
  } catch {
    // Ultimate fallback - if any validation fails, return as text
    const fallbackValue = typeof typeOrValue === 'object' && typeOrValue !== null
      ? `[${typeof typeOrValue}]`
      : String(typeOrValue);
    return { type: "text", value: fallbackValue } as SpanInputOutput;
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
