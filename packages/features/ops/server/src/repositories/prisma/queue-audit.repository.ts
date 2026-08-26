import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";

export type QueueControlAction = "queue_redrive_dlq_groups" | "queue_discard_dlq_groups";

/**
 * Audit sink for GroupQueue dead-letter recovery
 * (specs/ops/dead-letter-recovery.feature). The Redis substrate forgets DLQ
 * entries at their TTL, so for a discard THIS row is the retained mark: the
 * queue, the groups, how many jobs they held, and their last errors survive
 * here after the entries themselves are gone.
 */
export interface QueueAuditSink {
  append(entry: {
    actorUserId: string;
    action: QueueControlAction;
    queueName: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

const TARGET_KIND = "queue_dlq";
const auditMetadataSchema = z.record(z.string(), z.json());

/** For app presets that run without Postgres. */
export class NullQueueAuditSink implements QueueAuditSink {
  async append(): Promise<void> {
    // no-op
  }
}

/** Writes queue dead-letter operator actions to the shared audit log. */
export class QueueAuditRepository implements QueueAuditSink {
  private constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): QueueAuditRepository {
    return new QueueAuditRepository(prisma);
  }

  async append(entry: {
    actorUserId: string;
    action: QueueControlAction;
    queueName: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.actorUserId,
        // Queues are cross-project worker infrastructure; there is no single
        // project to scope the act to, and inventing one would mislead.
        projectId: null,
        organizationId: null,
        action: entry.action,
        targetKind: TARGET_KIND,
        targetId: entry.queueName,
        metadata: auditMetadataSchema.parse(entry.metadata ?? {}),
      },
    });
  }
}
