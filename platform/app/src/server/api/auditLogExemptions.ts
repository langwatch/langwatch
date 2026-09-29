/**
 * Which mutations do NOT leave an audit row.
 *
 * Every other mutation does: `auditLogMutations` in `trpc.ts` records the
 * acting user, the organization or project the input names, the action path
 * and the arguments, for anything that changes state. That is why this list
 * is the interesting one — it is the whole of what is not on the record.
 *
 * Its own module rather than a pair of constants inside `trpc.ts` so the
 * question "is this action audited" can be asked by a test without importing
 * the entire procedure builder, which reaches the database, the App and every
 * router behind it. A rule nobody can ask about is a rule nobody checks.
 */

/**
 * Mutations that fire on a heartbeat / per-tab cadence and aren't worth
 * recording in the audit log. `presence.*` runs every ~15s per open tab
 * (heartbeat + cursor broadcasts + leave on pagehide); auditing them
 * buries every genuine action — project edits, deletions, role changes —
 * under a wall of `presence.update` rows. They're already silenced from
 * the request log via SILENCED_LOG_PATH_PREFIXES; this is the audit-log
 * equivalent.
 *
 * Add new entries here when a router's mutations exist purely for
 * ephemeral session state that doesn't need a permanent forensic record.
 */
const AUDIT_LOG_EXEMPT_PATHS = new Set(["user.updateLastLogin"]);
const AUDIT_LOG_EXEMPT_PATH_PREFIXES = ["presence."] as const;

/**
 * Mutations that are audited MORE than the generic middleware can manage, by
 * their own handler.
 *
 * Not an exemption in the sense above — every path here still leaves a row —
 * but the generic middleware must stand down, or the change lands twice: once
 * as the arguments that went in, and once as the richer fact the handler
 * knows. `joinRequests.setJoining` is the case: what an administrator needs
 * to read months later is what the setting WAS as well as what it became, and
 * the previous value is not in the input.
 */
const SELF_AUDITED_PATHS = new Set(["joinRequests.setJoining"]);

export function isAuditLogExempt(path: string): boolean {
  if (AUDIT_LOG_EXEMPT_PATHS.has(path)) return true;
  if (SELF_AUDITED_PATHS.has(path)) return true;
  return AUDIT_LOG_EXEMPT_PATH_PREFIXES.some((prefix) =>
    path.startsWith(prefix),
  );
}

/** Whether this path writes its own, richer audit row. Exported so a test can
 *  tell "not recorded at all" from "recorded by the handler". */
export function isSelfAudited(path: string): boolean {
  return SELF_AUDITED_PATHS.has(path);
}
