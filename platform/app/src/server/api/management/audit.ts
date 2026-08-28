/**
 * This process's audit sink for management API writes.
 *
 * Same fire-and-forget pattern as the tRPC `apiKey` router's `auditLog`
 * calls: the write has already committed, so a logging failure must not fail
 * the response.
 *
 * The port is the seam a packaged management family emits through; the actor
 * rule (`management.<resource>.<verb>`, and a service key recorded as
 * `apikey:<id>`) lives with the families in
 * `@langwatch/platform-api/app-rest`, so both surfaces attribute a write the
 * same way.
 */
import {
  type AppRestManagementAuditPort,
  emitManagementAudit as emitPackagedManagementAudit,
} from "@langwatch/platform-api/app-rest";
import type { Context } from "hono";

import { auditLog } from "~/runtime/app/features/audit-log";
import { captureException } from "~/utils/posthogErrorCapture";

/** The audit sink the packaged management families emit through. */
export const managementAuditPort: AppRestManagementAuditPort = (entry) => {
  void auditLog({
    userId: entry.userId,
    organizationId: entry.organizationId,
    action: entry.action,
    args: entry.args,
  }).catch((error) => captureException(error instanceof Error ? error : new Error(String(error))));
};

/** The same emission for a family still mounted from this application. */
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
  emitPackagedManagementAudit({
    c,
    audit: managementAuditPort,
    organizationId,
    action,
    ...(args === undefined ? {} : { args }),
  });
}
