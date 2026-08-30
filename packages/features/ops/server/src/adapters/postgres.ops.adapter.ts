import type {
  BackofficeUserRow,
  OpsService as OpsServiceContract,
  UserWithBackofficeIncludes,
} from "@langwatch/ops-contract";
import type { AuthService } from "@langwatch/auth-contract";
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
import { type AdminAuditSink, ImpersonationService } from "../services/impersonation.service";
import { OpsService } from "../services/ops.service";
import { BlobStoreService } from "../services/blob-store.service";
import { BlobStoreRedisRepository } from "../repositories/redis/redis.blob-store.repository";
import { NullBlobStoreRepository } from "../repositories/blob-store.repository";
import { PrismaAdminBackofficeRepository } from "../repositories/prisma/prisma.admin-backoffice.repository";
import { AdminBackofficeService } from "../services/admin-backoffice.service";
import type { SchedulerOpsRepository } from "../ports/scheduler-ops.port";
import type { SchedulerWakeService } from "../ports/scheduler-wake.port";
import { SchedulerOpsService } from "../services/scheduler-ops.service";
import { RedisAnomalyStateRepository } from "../repositories/redis/redis.anomaly-state.repository";
import { QueueRedisRepository } from "../repositories/redis/queue.repository";
import { QueueAuditRepository } from "../repositories/prisma/queue-audit.repository";
import { NullQueueRepository } from "../repositories/queue.repository";
import { QueueService } from "../services/queue.service";
import type { QueuePayloadDecoderPort } from "../ports/queue-payload-decoder.port";
import {
  PrismaSchedulerAuditRepository,
  type SchedulerAuditDatabase,
} from "../repositories/prisma/prisma.scheduler-audit.repository";

export interface PostgresOpsAdapterOptions extends AdminAccessServiceOptions {
  database: AdminDatabase & SchedulerAuditDatabase;
  audit: AdminAuditSink;
  access?: AdminAccess | undefined;
  now?: (() => Date) | undefined;
  redis?: IORedis | Cluster | undefined;
  queuePayloads?: QueuePayloadDecoderPort | undefined;
  users: UserService;
  auth: AuthService;
  scheduler: {
    repository: SchedulerOpsRepository;
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
      this.options.access ?? AdminAccessService.create({ adminEmails: this.options.adminEmails });
    const queues = this.options.redis
      ? QueueService.create({
          repo: new QueueRedisRepository(this.options.redis, this.queuePayloads()),
          audit: QueueAuditRepository.create(this.options.database),
        })
      : QueueService.create({ repo: new NullQueueRepository() });

    return OpsService.create({
      access,
      adminBackoffice: AdminBackofficeService.create({
        repository: PrismaAdminBackofficeRepository.create(this.options.database),
        users: this.options.users,
        auth: this.options.auth,
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
      scheduler: SchedulerOpsService.create({
        ...this.options.scheduler,
        audit: PrismaSchedulerAuditRepository.create(this.options.database),
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
