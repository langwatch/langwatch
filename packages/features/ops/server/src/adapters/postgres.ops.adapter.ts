import type {
  BackofficeUserRow,
  OpsService as OpsServiceContract,
  UserWithBackofficeIncludes,
} from "@langwatch/ops-contract";
import type { Cluster, Redis as IORedis } from "ioredis";
import type { UserService } from "@langwatch/user-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  type AdminDatabase,
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
import { BlobStoreService } from "../services/blob-store.service";
import { BlobStoreRedisRepository } from "../repositories/redis/redis.blob-store.repository";
import { NullBlobStoreRepository } from "../repositories/blob-store.repository";
import { PrismaAdminBackofficeRepository } from "../repositories/prisma/prisma.admin-backoffice.repository";
import { AdminBackofficeService } from "../services/admin-backoffice.service";
import type { SchedulerAuditSink } from "../ports/scheduler-audit.sink";
import type { SchedulerOpsRepository } from "../ports/scheduler-ops.repository";
import type { SchedulerWakeService } from "../ports/scheduler-wake.service";
import { SchedulerOpsService } from "../services/scheduler-ops.service";

export interface PostgresOpsAdapterOptions extends AdminAccessServiceOptions {
  database: AdminDatabase;
  audit: AdminAuditSink;
  access?: AdminAccess | undefined;
  now?: (() => Date) | undefined;
  redis?: IORedis | Cluster | undefined;
  users: UserService;
  scheduler: {
    repository: SchedulerOpsRepository;
    audit: SchedulerAuditSink;
    wake: SchedulerWakeService;
    projects: ProjectService;
  };
}

export class PostgresOpsAdapter {
  private constructor(private readonly options: PostgresOpsAdapterOptions) {}

  static create(options: PostgresOpsAdapterOptions): PostgresOpsAdapter {
    return new PostgresOpsAdapter(options);
  }

  static readonly userBackofficeInclude = PrismaAdminUserMapper.USER_BACKOFFICE_INCLUDE;
  static readonly organizationSafeSelect = ORGANIZATION_SAFE_SELECT;
  static readonly projectSafeSelect = PROJECT_SAFE_SELECT;

  static mapUserToBackofficeRow(user: UserWithBackofficeIncludes): BackofficeUserRow {
    return PrismaAdminUserMapper.map(user);
  }

  build(): OpsServiceContract {
    const access =
      this.options.access ??
      AdminAccessService.create({ adminEmails: this.options.adminEmails });
    return OpsService.create({
      access,
      adminBackoffice: AdminBackofficeService.create({
        repository: PrismaAdminBackofficeRepository.create(this.options.database),
        users: this.options.users,
        audit: this.options.audit,
      }),
      blobStore: BlobStoreService.create(
        this.options.redis
          ? BlobStoreRedisRepository.create(this.options.redis)
          : NullBlobStoreRepository.create(),
      ),
      impersonation: ImpersonationService.create({
        repository: PrismaImpersonationRepository.create(this.options.database),
        access,
        audit: this.options.audit,
        now: this.options.now,
      }),
      scheduler: SchedulerOpsService.create(this.options.scheduler),
    });
  }
}
