import type { Context } from "hono";

/**
 * Audit emission for management API writes, as a port.
 *
 * The write has already committed by the time this is called, so a logging
 * failure must not fail the response — the port returns `void` rather than a
 * promise on purpose, and the process that supplies it owns the swallow.
 * Action names follow `management.<resource>.<verb>`.
 */
export type AppRestManagementAuditPort = (entry: {
  /** {@link managementActor}: the member, or the credential acting as nobody. */
  userId: string;
  organizationId: string;
  action: `management.${string}.${string}`;
  args?: Record<string, unknown>;
}) => void;

/**
 * The audit actor behind an org-authenticated management request.
 *
 * The user the credential acts as; a service key acts as nobody, so it is
 * recorded as `apikey:<id>`, still one stable string per credential, so an
 * audit reader can group a provisioning run's writes.
 */
export function managementActor(c: Context): string {
  const userId = c.get("apiKeyUserId") as string | null | undefined;
  if (userId) return userId;
  return `apikey:${c.get("apiKeyId") as string}`;
}

/** {@link managementActor}, already applied, for a family's one-line call sites. */
export function emitManagementAudit({
  c,
  audit,
  organizationId,
  action,
  args,
}: {
  c: Context;
  audit: AppRestManagementAuditPort;
  organizationId: string;
  action: `management.${string}.${string}`;
  args?: Record<string, unknown>;
}): void {
  audit({
    userId: managementActor(c),
    organizationId,
    action,
    ...(args === undefined ? {} : { args }),
  });
}
