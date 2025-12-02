import { z } from "zod";
import {
  chatMessageSchema,
  spanInputOutputSchema,
} from "../../internal/generated/types/tracer.generated";
import { type ChatMessage, type SpanInputOutput } from "../../internal/generated/types/tracer";
import { type SimpleChatMessage, type JsonSerializable, type InputOutputType, INPUT_OUTPUT_TYPES } from "./types";

/**
 * Zod schema for simple chat messages (less strict than the generated one)
 */
const simpleChatMessageSchema = z.object({
  role: z.string(),
  content: z.union([z.string(), z.array(z.any())]).nullable().optional()
});

const simpleChatMessageArraySchema = z.array(simpleChatMessageSchema);

/**
 * Utility function to create a safe fallback value
 */
function createSafeFallbackValue(value: unknown): string {
  return `[${typeof value}]`;
  // if (typeof value === 'object' && value !== null) {
  //   try {
  //     return JSON.stringify(value);
  //   } catch {
  //     // Fallback on JSON.stringify failure as final step
  //     return JSON.stringify({ type: "raw", value: "[Non-Serializable]" });
  //   }
  // }

  // return String(value);
}

/**
 * Utility function to create a safe SpanInputOutput fallback
 */
function createSafeSpanInputOutput(type: "text" | "raw", value: unknown): SpanInputOutput {
  const safeValue = createSafeFallbackValue(value);
  return { type, value: safeValue } as SpanInputOutput;
}

/**
 * Simple type checks for common input/output types
 */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatMessage(value: unknown): value is ChatMessage | SimpleChatMessage {
  if (!isObject(value)) return false;
  return (
    typeof value.role === "string" &&
    (typeof value.content === "string" || value.content === null || value.content === undefined)
  );
}

function isChatMessageArray(value: unknown): value is (ChatMessage | SimpleChatMessage)[] {
  return Array.isArray(value) && value.every(isChatMessage);
}

/**
 * Attempts to validate and convert chat messages with fallback strategies
 */
function processChatMessages(value: unknown): SpanInputOutput {
  // Ensure we have an array
  const messages = Array.isArray(value) ? value : [value];

  // Strategy 1: Try strict schema first
  const strictResult = z.array(chatMessageSchema).safeParse(messages);
  if (strictResult.success) {
    return { type: "chat_messages", value: strictResult.data } as SpanInputOutput;
  }

  // Strategy 2: Try simple schema
  const simpleResult = simpleChatMessageArraySchema.safeParse(messages);
  if (simpleResult.success) {
    return { type: "chat_messages", value: simpleResult.data } as SpanInputOutput;
  }

  // Strategy 3: Fallback to text
  return createSafeSpanInputOutput("text", JSON.stringify(messages));
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

    // Handle chat messages (single message or array)
    if (isChatMessage(value) || (Array.isArray(value) && value.length > 0 && isChatMessageArray(value))) {
      return processChatMessages(value);
    }

    // Handle arrays (non-chat messages)
    if (Array.isArray(value)) {
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
        // If json type fails, fall back to text
        return createSafeSpanInputOutput("text", value);
      }
    }

    // Ultimate fallback for any other type
    return createSafeSpanInputOutput("text", value);
  } catch {
    // Ultimate fallback - if any Zod validation fails, return as text
    return createSafeSpanInputOutput("text", value);
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
      const messages = Array.isArray(value) ? value : [value];

      // Try strict schema first
      const strictResult = z.array(chatMessageSchema).safeParse(messages);
      if (strictResult.success) {
        return strictResult.data;
      }

      // Try simple schema
      const simpleResult = simpleChatMessageArraySchema.safeParse(messages);
      if (simpleResult.success) {
        return simpleResult.data;
      }

      // Fallback
      return [{ role: "user", content: createSafeFallbackValue(value) }];
    }

    case "list": {
      const listResult = z.array(spanInputOutputSchema).safeParse(value);
      return listResult.success ? listResult.data : [{ type: "text", value: createSafeFallbackValue(value) }];
    }

    case "json": {
      // For JSON, we accept any serializable value
      try {
        JSON.stringify(value);
        return value;
      } catch {
        return createSafeFallbackValue(value);
      }
    }

    case "text":
    case "raw": {
      const stringResult = z.string().safeParse(value);
      return stringResult.success ? stringResult.data : createSafeFallbackValue(value);
    }

    case "guardrail_result":
    case "evaluation_result": {
      // These types accept any value, just ensure it's serializable
      try {
        JSON.stringify(value);
        return value;
      } catch {
        return createSafeFallbackValue(value);
      }
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
      return result.success ? result.data : createSafeSpanInputOutput("raw", validatedValue);
    }

    // Auto-detect type when no explicit type is provided
    return convertToSpanInputOutput(typeOrValue);
  } catch {
    // Ultimate fallback - if any validation fails, return as text
    return createSafeSpanInputOutput("text", typeOrValue);
  }
}

/**
 * Type-safe method signature for span input/output processing
 */
export type SpanInputOutputMethod<T> = {
  (type: "text", value: string): T;
  (type: "raw", value: unknown): T;
  (type: "chat_messages", value: ChatMessage[] | SimpleChatMessage[]): T;
  (type: "list", value: SpanInputOutput[]): T;
  (type: "json", value: JsonSerializable): T;
  (type: "guardrail_result", value: unknown): T;
  (type: "evaluation_result", value: unknown): T;
  (value: unknown): T;
}
