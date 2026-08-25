import type { AdminIdentity } from "@langwatch/ops-contract";
import { auditLog } from "~/runtime/app/features/audit-log";
import {
  AdminAuditSink,
  PostgresOpsAdapter,
} from "@langwatch/ops-server";
export {
  type UserWithBackofficeIncludes,
} from "@langwatch/ops-contract";
import { prisma } from "~/server/db";

export { auditLog };

class AppAdminAuditSink extends AdminAuditSink {
  async record(entry: {
    userId: string;
    action: string;
    args: Record<string, unknown>;
    req: unknown;
  }): Promise<void> {
    await auditLog({ ...entry, req: entry.req as never });
  }
}

export const opsService = PostgresOpsAdapter.create({
  database: prisma,
  adminEmails: process.env.ADMIN_EMAILS ?? "",
  audit: new AppAdminAuditSink(),
}).build();

export const adminEmailList = (): readonly string[] => opsService.adminEmails();
export const isAdmin = (identity: AdminIdentity): boolean =>
  opsService.isAdmin(identity);
export const mapUserToBackofficeRow =
  PostgresOpsAdapter.mapUserToBackofficeRow;
export const ORGANIZATION_SAFE_SELECT =
  PostgresOpsAdapter.organizationSafeSelect;
export const PROJECT_SAFE_SELECT = PostgresOpsAdapter.projectSafeSelect;
export const USER_BACKOFFICE_INCLUDE =
  PostgresOpsAdapter.userBackofficeInclude;
