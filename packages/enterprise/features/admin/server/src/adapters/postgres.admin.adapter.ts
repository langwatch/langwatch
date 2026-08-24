import type {
  AdminAccess,
  AdminRuntime,
  BackofficeUserRow,
  UserWithBackofficeIncludes,
} from "@langwatch/enterprise-admin-contract";
import type { AdminDatabase } from "../ports/admin-database.port";
import {
  ORGANIZATION_SAFE_SELECT,
  PrismaImpersonationRepository,
  PROJECT_SAFE_SELECT,
} from "../repositories/prisma/prisma.admin.repository";
import { PrismaAdminUserMapper } from "../repositories/prisma/prisma.admin-user.mapper";
import {
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "../services/admin-access.service";
import {
  type AdminAuditSink,
  ImpersonationService,
} from "../services/impersonation.service";

export interface PostgresAdminAdapterOptions extends AdminAccessServiceOptions {
  database: AdminDatabase;
  audit: AdminAuditSink;
  access?: AdminAccess | undefined;
  now?: (() => Date) | undefined;
}

export type AdminServer = AdminRuntime;

export class PostgresAdminAdapter {
  private constructor(private readonly options: PostgresAdminAdapterOptions) {}

  static create(options: PostgresAdminAdapterOptions): PostgresAdminAdapter {
    return new PostgresAdminAdapter(options);
  }

  static readonly userBackofficeInclude =
    PrismaAdminUserMapper.USER_BACKOFFICE_INCLUDE;
  static readonly organizationSafeSelect = ORGANIZATION_SAFE_SELECT;
  static readonly projectSafeSelect = PROJECT_SAFE_SELECT;

  static mapUserToBackofficeRow(
    user: UserWithBackofficeIncludes,
  ): BackofficeUserRow {
    return PrismaAdminUserMapper.map(user);
  }

  build(): AdminServer {
    const access =
      this.options.access ??
      AdminAccessService.create({ adminEmails: this.options.adminEmails });
    return {
      access,
      impersonation: ImpersonationService.create({
        repository: PrismaImpersonationRepository.create(this.options.database),
        access,
        audit: this.options.audit,
        now: this.options.now,
      }),
    };
  }
}
