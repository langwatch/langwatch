import type { LlmConfigOutputType } from "~/types";

/**
 * Configuration for a single output field.
 */
export interface OutputConfig {
  identifier: string;
  type: LlmConfigOutputType;
}

/**
 * Converts a raw output value to a streamable string representation.
 * Returns undefined if the value cannot be formatted for streaming.
 *
 * @param value - The raw value from execution state outputs
 * @param type - The configured output type
 * @returns String representation for streaming, or undefined if not formattable
 */
export function formatOutputForStreaming(
  value: unknown,
  type: LlmConfigOutputType
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  switch (type) {
    case "str":
      return typeof value === "string" ? value : String(value);
    case "float":
      return typeof value === "number" ? String(value) : undefined;
    case "bool":
      return typeof value === "boolean" ? String(value) : undefined;
    case "json_schema":
      return typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : undefined;
    default:
      // Exhaustive check - TypeScript will error if new types are added
      const _exhaustive: never = type;
      return undefined;
  }
}

/**
 * Extracts the streamable output value from execution state.
 * Uses the first configured output field to determine which value to extract.
 *
 * @param outputs - The outputs dictionary from execution state
 * @param config - The first output configuration (determines field name and type)
 * @returns Formatted string for streaming, or undefined if not available
 */
export function extractStreamableOutput(
  outputs: Record<string, unknown> | undefined,
  config: OutputConfig | undefined
): string | undefined {
  if (!outputs || !config) {
    return undefined;
  }

  const rawValue = outputs[config.identifier];
  return formatOutputForStreaming(rawValue, config.type);
}
