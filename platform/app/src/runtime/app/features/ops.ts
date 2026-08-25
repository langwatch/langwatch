import { auditLog } from "~/runtime/app/features/audit-log";
import type { AdminAuditRequest, AuditLogRequestLike } from "@langwatch/ops-contract";
import {
  AdminAuditSink,
  PostgresOpsAdapter,
  type SchedulerAuditSink,
  type SchedulerOpsRepository,
  type SchedulerWakeService,
} from "@langwatch/ops-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Cluster, Redis } from "ioredis";
import type { UserService } from "@langwatch/user-contract";
import type { ProjectService } from "@langwatch/project-contract";
export { auditLog };

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
    audit: SchedulerAuditSink;
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
    }).build();
  }
}
