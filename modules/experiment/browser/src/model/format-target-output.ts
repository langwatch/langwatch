/**
 * Shared utility for formatting target outputs for display.
 */

/**
 * Checks if the output is an object with exactly one key named "output".
 * This is the special case where we unwrap to show just the content.
 */
const isSingleOutputKey = (output: unknown): output is { output: unknown } => {
  if (output === null || output === undefined) return false;
  if (typeof output !== "object") return false;
  if (Array.isArray(output)) return false;

  const keys = Object.keys(output);
  return keys.length === 1 && keys[0] === "output";
};

/**
 * Formats a target output value for display.
 * @param output - The raw output value (could be object, primitive, null, etc.)
 * @returns The formatted string for display
 */
export const formatTargetOutput = (output: unknown): string => {
  // Handle null/undefined
  if (output === null || output === undefined) {
    return "";
  }

  // Handle non-objects (primitives like string, number, boolean)
  if (typeof output !== "object") {
    return String(output);
  }

  // Handle arrays - always stringify
  if (Array.isArray(output)) {
    return JSON.stringify(output, null, 2);
  }

  // Handle objects
  // Special case: single key named "output" -> unwrap and display content
  if (isSingleOutputKey(output)) {
    const content = output.output;
    if (content === null || content === undefined) {
      return "";
    }
    if (typeof content === "object") {
      return JSON.stringify(content, null, 2);
    }
    return String(content);
  }

  // All other objects: display as formatted JSON
  return JSON.stringify(output, null, 2);
};

/**
 * Unwraps the output value if it's a single-key "output" object.
 * @param output - The raw output value
 * @returns The unwrapped value or original value
 */
export const unwrapSingleOutputKey = (output: unknown): unknown => {
  if (isSingleOutputKey(output)) {
    return output.output;
  }
  return output;
};
