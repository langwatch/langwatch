import { readHandledError } from "@langwatch/handled-error/read-handled-error";

/** The codes a server refusal for a missing grant arrives under. */
const PERMISSION_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "permission_denied",
  "project_permission_denied",
  "insufficient_permissions",
]);

/** Whether a failed query was refused for a grant the viewer does not hold. */
export function isPermissionRefusal(error: unknown): boolean {
  const handled = readHandledError(error);
  return handled !== null && PERMISSION_REFUSAL_CODES.has(handled.code);
}
