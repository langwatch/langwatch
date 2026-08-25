import { auditLog } from "~/runtime/app/features/audit-log";
import type { AdminAuditRequest, AuditLogRequestLike } from "@langwatch/ops-contract";
import {
  AdminAuditSink,
  mapUserToBackofficeRow,
  ORGANIZATION_SAFE_SELECT,
  PostgresOpsAdapter,
  PROJECT_SAFE_SELECT,
  USER_BACKOFFICE_INCLUDE,
} from "@langwatch/ops-server";
export { auditLog };
export {
  mapUserToBackofficeRow,
  ORGANIZATION_SAFE_SELECT,
  PROJECT_SAFE_SELECT,
  USER_BACKOFFICE_INCLUDE,
};

/**
 * App composition adapter. The audit runtime remains a named legacy residual
 * until the Audit feature is fully composed through the request App.
 */
export class AppOpsAuditSink extends AdminAuditSink {
  async record(entry: {
    userId: string;
    action: string;
    args: Record<string, unknown>;
    req: AdminAuditRequest;
  }): Promise<void> {
    await auditLog({ ...entry, req: auditLogRequestFrom(entry.req) });
  }
}

function auditLogRequestFrom(value: AdminAuditRequest): AuditLogRequestLike {
  return {
    headers: value.headers,
    ...(value.remoteAddress ? { socket: { remoteAddress: value.remoteAddress } } : {}),
  };
}

export type AppOpsRuntimeOptions = Omit<
  Parameters<typeof PostgresOpsAdapter.create>[0],
  "audit"
>;

export class AppOpsRuntime {
  private constructor(private readonly options: AppOpsRuntimeOptions) {}

  static create(options: AppOpsRuntimeOptions): AppOpsRuntime {
    return new AppOpsRuntime(options);
  }

  build() {
    return PostgresOpsAdapter.create({
      ...this.options,
      audit: new AppOpsAuditSink(),
    }).build();
  }
}
