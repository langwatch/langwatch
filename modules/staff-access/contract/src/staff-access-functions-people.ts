/**
 * The people ops functions (ADR-202).
 * Spec: modules/staff-access/specs/staff-access-functions-people.feature
 */
import type { StaffAccessFunctionEntry } from "./staff-access-function-shapes.ts";

export const STAFF_ACCESS_PEOPLE_FUNCTIONS = {} as const satisfies Record<
  string,
  StaffAccessFunctionEntry
>;
