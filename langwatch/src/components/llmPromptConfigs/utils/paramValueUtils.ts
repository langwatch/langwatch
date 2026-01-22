/**
 * Parameter Value Utilities
 *
 * Helper functions for getting and setting parameter values,
 * handling the snake_case/camelCase conversion.
 */

import { toFormKey } from "../parameterConfig";
import type { LLMConfigValues } from "../types";

// ============================================================================
// Parameter Value Access
// ============================================================================

/**
 * Get the parameter value from the config values.
 * Handles both snake_case (internal) and camelCase (form) key formats.
 *
 * @param values - LLM config values
 * @param paramName - Parameter name in snake_case (e.g., "top_p")
 * @returns Parameter value or undefined
 */
export function getParamValue(
  values: LLMConfigValues,
  paramName: string,
): number | string | undefined {
  const formKey = toFormKey(paramName);
  const record = values as Record<string, unknown>;

  // Check snake_case key first (internal), then camelCase key (form)
  return (record[paramName] ?? record[formKey]) as number | string | undefined;
}
