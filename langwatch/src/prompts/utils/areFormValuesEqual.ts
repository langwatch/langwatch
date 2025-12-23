import isEqual from "lodash.isequal";
import type { DeepPartial } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts";

/**
 * Compare two form values for deep equality after JSON normalization.
 * Single Responsibility: Normalize and compare form values to detect changes.
 * @param a - First form values to compare
 * @param b - Second form values to compare
 * @returns true if values are deeply equal after normalization, false otherwise
 */
export function areFormValuesEqual(
  a?: DeepPartial<PromptConfigFormValues>,
  b?: DeepPartial<PromptConfigFormValues>,
): boolean {
  if (!a || !b) return false;
  // Use JSON.stringify to normalize the objects for comparison (ie Dates, etc)
  return isEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
}
