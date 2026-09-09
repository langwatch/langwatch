import type { BackofficeUserRow, UserWithBackofficeIncludes } from "@langwatch/ops-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { Cluster, Redis as IORedis } from "ioredis";
import type { UserApi } from "@langwatch/user-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  type AdminDatabase,
  ORGANIZATION_SAFE_SELECT,
  PrismaImpersonationRepository,
  PROJECT_SAFE_SELECT,
} from "../repositories/prisma/prisma.admin.repository.ts";
import { PrismaAdminUserMapper } from "../repositories/prisma/prisma.admin-user.mapper.ts";
import {
  type AdminAccess,
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "../services/admin-access.service.ts";
import { type AdminAuditSink, ImpersonationService } from "../services/impersonation.service.ts";
import { OpsService } from "../services/ops.service.ts";
import { BlobStoreService } from "../services/blob-store.service.ts";
import { BlobStoreRedisRepository } from "../repositories/redis/redis.blob-store.repository.ts";
import { NullBlobStoreRepository } from "../repositories/blob-store.repository.ts";
import { PrismaAdminBackofficeRepository } from "../repositories/prisma/prisma.admin-backoffice.repository.ts";
import { AdminBackofficeService } from "../services/admin-backoffice.service.ts";
import type { SchedulerOpsRepository } from "../repositories/scheduler-ops.repository.ts";
import type { SchedulerWakePort } from "../ports/scheduler-wake.port.ts";
import { SchedulerOpsService } from "../services/scheduler-ops.service.ts";
import { RedisAnomalyStateRepository } from "../repositories/redis/redis.anomaly-state.repository.ts";
import { QueueRedisRepository } from "../repositories/redis/queue.repository.ts";
import { QueueAuditAdapter } from "../adapters/audit-log.queue-audit.adapter.ts";
import { NullQueueRepository } from "../repositories/queue.repository.ts";
import { QueueService } from "../services/queue.service.ts";
import type { QueuePayloadDecoderPort } from "../ports/queue-payload-decoder.port.ts";
import {
  PrismaSchedulerAuditRepository,
  type SchedulerAuditDatabase,
} from "../repositories/prisma/prisma.scheduler-audit.repository.ts";
import type { Instant } from "@langwatch/time";

export interface OpsOperationsOptions extends AdminAccessServiceOptions {
  database: AdminDatabase & SchedulerAuditDatabase;
  audit: AdminAuditSink;
  /** The shared audit log every operator act is recorded on. */
  auditLog: AuditLogApi;
  access?: AdminAccess | undefined;
  now?: (() => Instant) | undefined;
  redis?: IORedis | Cluster | undefined;
  queuePayloads?: QueuePayloadDecoderPort | undefined;
  users: UserApi;
  auth: AuthApi;
  /** True once the connection projection decides sign-in (`SSOCONN_ROUTING=enforce`). */
  legacySsoStringWritesRetired?: boolean | undefined;
  scheduler: {
    repository: SchedulerOpsRepository;
    wake: SchedulerWakePort;
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
          audit: QueueAuditAdapter.create({ auditLog: this.options.auditLog }),
        })
      : QueueService.create({ repo: NullQueueRepository.create() });

    return OpsService.create({
      access,
      adminBackoffice: AdminBackofficeService.create({
        repository: PrismaAdminBackofficeRepository.create(this.options.database),
        users: this.options.users,
        auth: this.options.auth,
        audit: this.options.audit,
        legacySsoStringWritesRetired: this.options.legacySsoStringWritesRetired,
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

  private queuePayloads(): QueuePayloadDecoderPort {
    if (!this.options.queuePayloads) {
      throw new Error("Ops queue composition requires a payload decoder when Redis is configured");
    }

    return this.options.queuePayloads;
  }
}
