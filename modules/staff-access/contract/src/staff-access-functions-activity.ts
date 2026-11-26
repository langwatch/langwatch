/**
 * The activity ops functions (ADR-202).
 * Spec: modules/staff-access/specs/staff-access-functions-activity.feature
 */
import type { StaffAccessFunctionEntry } from "./staff-access-function-shapes.ts";

export const STAFF_ACCESS_ACTIVITY_FUNCTIONS = {} as const satisfies Record<
  string,
  StaffAccessFunctionEntry
>;
