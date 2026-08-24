import {
  AdminAccess,
  type AdminIdentity,
} from "@langwatch/enterprise-admin-contract";
import { auditLog } from "~/runtime/app/features/audit-log";
import {
  AdminAuditSink,
  AdminAccessService,
  PostgresAdminAdapter,
} from "@langwatch/enterprise-admin-server";
export {
  type UserWithBackofficeIncludes,
} from "@langwatch/enterprise-admin-contract";
import { prisma } from "~/server/db";

export const adminEmailList = (): string[] =>
  AdminAccessService.parseEmails(process.env.ADMIN_EMAILS ?? "");

export { auditLog };

export const isAdmin = (identity: AdminIdentity): boolean => {
  if (!identity.email) return false;
  return adminEmailList().includes(identity.email.trim().toLowerCase());
};

class AppAdminAccess extends AdminAccess {
  isAdmin(identity: AdminIdentity): boolean {
    return isAdmin(identity);
  }

  emails(): readonly string[] {
    return adminEmailList();
  }
}

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

const adminServer = PostgresAdminAdapter.create({
  database: prisma,
  adminEmails: [],
  access: new AppAdminAccess(),
  audit: new AppAdminAuditSink(),
}).build();

export const impersonationService = adminServer.impersonation;
export const mapUserToBackofficeRow =
  PostgresAdminAdapter.mapUserToBackofficeRow;
export const ORGANIZATION_SAFE_SELECT =
  PostgresAdminAdapter.organizationSafeSelect;
export const PROJECT_SAFE_SELECT = PostgresAdminAdapter.projectSafeSelect;
export const USER_BACKOFFICE_INCLUDE =
  PostgresAdminAdapter.userBackofficeInclude;
