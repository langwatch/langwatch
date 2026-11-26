/**
 * The langy ops functions (ADR-202).
 * Spec: modules/staff-access/specs/staff-access-functions-langy.feature
 */
import type { StaffAccessFunctionEntry } from "./staff-access-function-shapes.ts";

export const STAFF_ACCESS_LANGY_FUNCTIONS = {} as const satisfies Record<
  string,
  StaffAccessFunctionEntry
>;
