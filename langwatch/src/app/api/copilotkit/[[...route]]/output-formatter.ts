import type { LlmConfigOutputType } from "~/types";

/**
 * Configuration for a single output field.
 */
export interface OutputConfig {
  identifier: string;
  type: LlmConfigOutputType;
}

/**
 * Checks if a value is valid for the given type.
 * Returns true if the value can be formatted for streaming.
 */
function isValidValueForType(value: unknown, type: LlmConfigOutputType): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  switch (type) {
    case "str":
      return true; // Can always convert to string
    case "float":
      return typeof value === "number";
    case "bool":
      return typeof value === "boolean";
    case "json_schema":
      return typeof value === "object";
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unhandled output type: ${_exhaustive}`);
    }
  }
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
 * The default identifier that displays values as-is without JSON wrapping.
 */
const DEFAULT_OUTPUT_IDENTIFIER = "output";

/**
 * Extracts the streamable output value from execution state.
 * Supports both single and multiple output configurations.
 *
 * Single output with identifier "output" (default): displays value as-is.
 * Single output with custom identifier: wraps in JSON object.
 * Multiple outputs: combines all outputs into a single JSON object.
 *
 * @param outputs - The outputs dictionary from execution state
 * @param configs - Array of output configurations
 * @returns Formatted string for streaming, or undefined if not available
 */
export function extractStreamableOutput(
  outputs: Record<string, unknown> | undefined,
  configs: OutputConfig[] | undefined
): string | undefined {
  if (!outputs || !configs || configs.length === 0) {
    return undefined;
  }

  // Single output case
  if (configs.length === 1) {
    const config = configs[0]!;
    const rawValue = outputs[config.identifier];

    // Validate value using the same function as multiple outputs case
    if (!isValidValueForType(rawValue, config.type)) {
      return undefined;
    }

    // Default "output" identifier: display value as-is
    if (config.identifier === DEFAULT_OUTPUT_IDENTIFIER) {
      return formatOutputForStreaming(rawValue, config.type);
    }

    // Custom identifier: wrap in JSON object with the identifier as key
    return JSON.stringify({ [config.identifier]: rawValue }, null, 2);
  }

  // Multiple outputs case: combine all valid outputs into a single JSON object
  const combinedOutputs: Record<string, unknown> = {};
  let hasAnyOutput = false;

  for (const config of configs) {
    const rawValue = outputs[config.identifier];
    if (isValidValueForType(rawValue, config.type)) {
      combinedOutputs[config.identifier] = rawValue;
      hasAnyOutput = true;
    }
  }

  if (!hasAnyOutput) {
    return undefined;
  }

  return JSON.stringify(combinedOutputs, null, 2);
}
