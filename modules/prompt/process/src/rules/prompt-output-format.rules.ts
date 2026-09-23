/**
 * How one execution state's outputs become the text the playground streams.
 * Lifted out of the CopilotKit runtime when that was removed; pure, so the
 * transport can change without touching the part proven in production.
 */
import type { LlmConfigOutputType } from "@langwatch/prompt-contract";

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
      throw new Error(`Unhandled output type: ${JSON.stringify(_exhaustive)}`);
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
  type: LlmConfigOutputType,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  switch (type) {
    case "str":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "float":
      return typeof value === "number" ? String(value) : undefined;
    case "bool":
      return typeof value === "boolean" ? String(value) : undefined;
    case "json_schema":
      return typeof value === "object" ? JSON.stringify(value, null, 2) : undefined;
    default: {
      // Exhaustive check - TypeScript will error if new types are added
      const _exhaustive: never = type;
      return void _exhaustive;
    }
  }
}

/**
 * The default identifier that displays values as-is without JSON wrapping.
 */
const DEFAULT_OUTPUT_IDENTIFIER = "output";

function formatSingleStreamableOutput(
  outputs: Record<string, unknown>,
  config: OutputConfig,
): string | undefined {
  const rawValue = outputs[config.identifier];

  if (!isValidValueForType(rawValue, config.type)) {
    return undefined;
  }

  if (config.identifier === DEFAULT_OUTPUT_IDENTIFIER) {
    return formatOutputForStreaming(rawValue, config.type);
  }

  const valueToWrap = config.type === "str" ? formatOutputForStreaming(rawValue, "str") : rawValue;
  return JSON.stringify({ [config.identifier]: valueToWrap }, null, 2);
}

/**
 * Extracts the streamable output value from execution state: single outputs as-is or
 * JSON-wrapped, or multiple outputs combined into a single JSON object.
 */
export function extractStreamableOutput(
  outputs: Record<string, unknown> | undefined,
  configs: OutputConfig[] | undefined,
): string | undefined {
  if (!outputs || !configs || configs.length === 0) {
    return undefined;
  }

  // Single output case
  if (configs.length === 1) {
    const config = configs[0]!;
    return formatSingleStreamableOutput(outputs, config);
  }

  // Multiple outputs case: combine all valid outputs into a single JSON object
  const combinedOutputs: Record<string, unknown> = {};
  let hasAnyOutput = false;

  for (const config of configs) {
    const rawValue = outputs[config.identifier];
    if (isValidValueForType(rawValue, config.type)) {
      // Coerce str types to ensure consistent string representation
      combinedOutputs[config.identifier] =
        config.type === "str" ? formatOutputForStreaming(rawValue, "str") : rawValue;
      hasAnyOutput = true;
    }
  }

  if (!hasAnyOutput) {
    return undefined;
  }

  return JSON.stringify(combinedOutputs, null, 2);
}
