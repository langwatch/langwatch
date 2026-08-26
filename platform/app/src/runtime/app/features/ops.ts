import { auditLog } from "~/runtime/app/features/audit-log";
import type { AdminAuditRequest, AuditLogRequestLike } from "@langwatch/ops-contract";
import {
  AdminAuditSink,
  PostgresOpsAdapter,
  QueuePayloadDecoderPort,
  type SchedulerOpsRepository,
  type SchedulerWakeService,
} from "@langwatch/ops-server";
import {
  decodeJobEnvelope,
  RedisJobBlobStore,
  TieredBlobStore,
} from "@langwatch/group-queue/operational";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Cluster, Redis } from "ioredis";
import type { UserService } from "@langwatch/user-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { createStorageRegistry } from "~/server/stored-objects/stored-objects-factory";
export { auditLog };

const logger = createLogger("langwatch:ops:queue-payload-decoder");

class AppQueuePayloadDecoder extends QueuePayloadDecoderPort {
  private constructor(private readonly redis: Redis | Cluster) {
    super();
  }

  static create(redis: Redis | Cluster): AppQueuePayloadDecoder {
    return new AppQueuePayloadDecoder(redis);
  }

  async tryDecode(input: {
    queueName: string;
    value: string;
  }): Promise<Record<string, unknown> | null> {
    try {
      const tieredBlobs = new TieredBlobStore({
        redisBlobs: new RedisJobBlobStore({
          redis: this.redis,
          queueName: input.queueName,
        }),
        objectStoreFor: (projectId) => createStorageRegistry({ projectId }),
        resolveDestination: resolveProjectStorageDestination,
        queueName: input.queueName,
        logger,
      });
      return await decodeJobEnvelope({
        value: input.value,
        tieredBlobs,
        readMode: "peek",
      });
    } catch {
      return null;
    }
  }
}

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

/**
 * The app's process-composition inputs for the Ops feature.
 *
 * Audit recording is intentionally absent: the application supplies that
 * adapter itself, keeping the Ops package's repositories and collaborators
 * private to its process-owned implementation.
 */
export interface AppOpsRuntimeOptions {
  database: PrismaClient;
  adminEmails: string | readonly string[];
  redis?: Redis | Cluster | undefined;
  users: UserService;
  scheduler: {
    repository: SchedulerOpsRepository;
    wake: SchedulerWakeService;
    projects: ProjectService;
  };
}

export class AppOpsRuntime {
  private constructor(private readonly options: AppOpsRuntimeOptions) {}

  static create(options: AppOpsRuntimeOptions): AppOpsRuntime {
    return new AppOpsRuntime(options);
  }

  build() {
    return PostgresOpsAdapter.create({
      ...this.options,
      audit: new AppOpsAuditSink(),
      queuePayloads: this.options.redis
        ? AppQueuePayloadDecoder.create(this.options.redis)
        : void 0,
    }).build();
  }
}
