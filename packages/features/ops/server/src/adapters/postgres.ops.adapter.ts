import type {
  BackofficeUserRow,
  OpsService as OpsServiceContract,
  UserWithBackofficeIncludes,
} from "@langwatch/ops-contract";
import type { AdminDatabase } from "../ports/admin-database.port";
import {
  ORGANIZATION_SAFE_SELECT,
  PrismaImpersonationRepository,
  PROJECT_SAFE_SELECT,
} from "../repositories/prisma/prisma.admin.repository";
import { PrismaAdminUserMapper } from "../repositories/prisma/prisma.admin-user.mapper";
import {
  type AdminAccess,
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "../services/admin-access.service";
import {
  type AdminAuditSink,
  ImpersonationService,
} from "../services/impersonation.service";
import { OpsService } from "../services/ops.service";

export interface PostgresOpsAdapterOptions extends AdminAccessServiceOptions {
  database: AdminDatabase;
  audit: AdminAuditSink;
  access?: AdminAccess | undefined;
  now?: (() => Date) | undefined;
}

export class PostgresOpsAdapter {
  private constructor(private readonly options: PostgresOpsAdapterOptions) {}

  static create(options: PostgresOpsAdapterOptions): PostgresOpsAdapter {
    return new PostgresOpsAdapter(options);
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

  build(): OpsServiceContract {
    const access =
      this.options.access ??
      AdminAccessService.create({ adminEmails: this.options.adminEmails });
    return OpsService.create({
      access,
      impersonation: ImpersonationService.create({
        repository: PrismaImpersonationRepository.create(this.options.database),
        access,
        audit: this.options.audit,
        now: this.options.now,
      }),
    });
  }
}
