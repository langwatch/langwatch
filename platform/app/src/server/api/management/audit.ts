/**
 * Audit emission for management API writes.
 *
 * Same fire-and-forget pattern as the tRPC `apiKey` router's `auditLog`
 * calls: the write has already committed, so a logging failure must not fail
 * the response. Action names follow `management.<resource>.<verb>`.
 *
 * The actor is the user the credential acts as; a service key acts as nobody,
 * so it is recorded as `apikey:<id>` — still one stable string per credential,
 * so an audit reader can group a provisioning run's writes.
 */
import { auditLog } from "@ee/audit-log/auditLog";
import type { Context } from "hono";

/** The audit actor behind an org-authenticated management request. */
export function managementActor(c: Context): string {
  const userId = c.get("apiKeyUserId") as string | null | undefined;
  if (userId) return userId;
  return `apikey:${c.get("apiKeyId") as string}`;
}

export function emitManagementAudit({
  c,
  organizationId,
  action,
  args,
}: {
  c: Context;
  organizationId: string;
  /** `management.<resource>.<verb>`, e.g. `management.role.create`. */
  action: `management.${string}.${string}`;
  args?: Record<string, unknown>;
}): void {
  void auditLog({
    userId: managementActor(c),
    organizationId,
    action,
    args,
  });
}
