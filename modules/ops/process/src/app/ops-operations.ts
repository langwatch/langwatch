import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { BackofficeUserRow, UserWithBackofficeIncludes } from "@langwatch/ops-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";
import type { Cluster, Redis as IORedis } from "ioredis";

import { NullBlobStoreRepository } from "../repositories/blob-store.repository.ts";
import { PrismaAdminBackofficeRepository } from "../repositories/prisma/prisma.admin-backoffice.repository.ts";
import { PrismaAdminUserMapper } from "../repositories/prisma/prisma.admin-user.mapper.ts";
import {
  type AdminDatabase,
  ORGANIZATION_SAFE_SELECT,
  PrismaImpersonationRepository,
  PROJECT_SAFE_SELECT,
} from "../repositories/prisma/prisma.admin.repository.ts";
import {
  PrismaSchedulerAuditRepository,
  type SchedulerAuditDatabase,
} from "../repositories/prisma/prisma.scheduler-audit.repository.ts";
import { NullQueueRepository } from "../repositories/queue.repository.ts";
import { QueueRedisRepository } from "../repositories/redis/queue.repository.ts";
import { RedisAnomalyStateRepository } from "../repositories/redis/redis.anomaly-state.repository.ts";
import { BlobStoreRedisRepository } from "../repositories/redis/redis.blob-store.repository.ts";
import type { SchedulerOpsRepository } from "../repositories/scheduler-ops.repository.ts";
import {
  type AdminAccess,
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "../services/admin-access.service.ts";
import {
  AdminBackofficeService,
  type OrganizationSsoRouting,
} from "../services/admin-backoffice.service.ts";
import { AuditLogQueueAuditService } from "../services/audit-log.queue-audit.service.ts";
import { BlobStoreService } from "../services/blob-store.service.ts";
import { type AdminAuditSink, ImpersonationService } from "../services/impersonation.service.ts";
import { OpsService } from "../services/ops.service.ts";
import { QueueService } from "../services/queue.service.ts";
import { SchedulerOpsService } from "../services/scheduler-ops.service.ts";
import type { SchedulerWake, QueuePayloadDecoder } from "./ops.app.ts";

export interface OpsOperationsOptions extends AdminAccessServiceOptions {
  database: AdminDatabase & SchedulerAuditDatabase;
  audit: AdminAuditSink;
  /** The shared audit log every operator act is recorded on. */
  auditLog: AuditLogApi;
  access?: AdminAccess | undefined;
  now?: (() => Instant) | undefined;
  redis?: IORedis | Cluster | undefined;
  queuePayloads?: QueuePayloadDecoder | undefined;
  users: UserApi;
  auth: AuthApi;
  /** Whether one organization's own connection decides its sign-in. */
  ssoRouting?: OrganizationSsoRouting | undefined;
  scheduler: {
    repository: SchedulerOpsRepository;
    wake: SchedulerWake;
    projects: ProjectApi;
  };
}

/**
 * The operations half of the application, built from the repositories and the
 * connections the process hands it. Not a persistence adapter: the backend
 * choice is the registry's, and this is where the services are composed.
 */
export class OpsOperations {
  private constructor(private readonly options: OpsOperationsOptions) {}

  static create(options: OpsOperationsOptions): OpsOperations {
    return new OpsOperations(options);
  }

  static readonly userBackofficeInclude = PrismaAdminUserMapper.USER_BACKOFFICE_INCLUDE;
  static readonly organizationSafeSelect = ORGANIZATION_SAFE_SELECT;
  static readonly projectSafeSelect = PROJECT_SAFE_SELECT;

  static mapUserToBackofficeRow(user: UserWithBackofficeIncludes): BackofficeUserRow {
    return PrismaAdminUserMapper.map(user);
  }

  build(): OpsService {
    const access =
      this.options.access ?? AdminAccessService.create({ adminEmails: this.options.adminEmails });
    const queues = this.options.redis
      ? QueueService.create({
          repo: QueueRedisRepository.create({
            redis: this.options.redis,
            payloads: this.queuePayloads(),
          }),
          audit: AuditLogQueueAuditService.create({ auditLog: this.options.auditLog }),
        })
      : QueueService.create({ repo: NullQueueRepository.create() });

    return OpsService.create({
      access,
      adminBackoffice: AdminBackofficeService.create({
        repository: PrismaAdminBackofficeRepository.create(this.options.database),
        users: this.options.users,
        auth: this.options.auth,
        audit: this.options.audit,
        ssoRouting: this.options.ssoRouting,
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
      scheduler: SchedulerOpsService.create({
        ...this.options.scheduler,
        audit: PrismaSchedulerAuditRepository.create({
          database: this.options.database,
          auditLog: this.options.auditLog,
        }),
      }),
      anomalyState: this.options.redis
        ? RedisAnomalyStateRepository.create(this.options.redis)
        : null,
      queues,
    });
  }

  private queuePayloads(): QueuePayloadDecoder {
    if (!this.options.queuePayloads) {
      throw new Error("Ops queue composition requires a payload decoder when Redis is configured");
    }

    return this.options.queuePayloads;
  }
}
