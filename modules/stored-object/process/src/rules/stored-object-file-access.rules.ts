import { HandledError } from "@langwatch/handled-error";

/** The codes the permission check raises when it refuses the caller. */
const DENIAL_CODES: ReadonlySet<string> = new Set([
  "project_permission_denied",
  "lite_member_restricted",
  // The ADR-092 engine's denial: without it here the engine's 403 would surface as a 500.
  "permission_denied",
]);

/**
 * True only for the denial shapes the permission check documents. Anything
 * else (a dropped connection, a Prisma fault) must bubble up as a 5xx.
 */
export function isPermissionDenial(err: unknown): boolean {
  return HandledError.isHandled(err) && DENIAL_CODES.has(err.code);
}
