import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";
import { QueueAuditSink, type QueueControlAction } from "../../ports/queue-audit.sink";

const auditMetadataSchema = z.record(z.string(), z.json());

/**
 * The audit log's target kinds for these acts, keyed by action.
 */
const TARGET_KIND_BY_ACTION: Record<QueueControlAction, string> = {
  queue_redrive_dlq_groups: "queue_dlq",
  queue_discard_dlq_groups: "queue_dlq",
  queue_drain_group: "queue",
  queue_drain_tenant: "queue",
  queue_move_group_to_dlq: "queue",
  queue_move_all_blocked_to_dlq: "queue",
  queue_unblock_group: "queue",
  queue_unblock_all: "queue",
};

/** Writes queue dead-letter operator actions to the shared audit log. */
export class QueueAuditRepository extends QueueAuditSink {
  static create({ prisma }: { prisma: PrismaClient }): QueueAuditRepository {
    return new QueueAuditRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
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
        targetKind: TARGET_KIND_BY_ACTION[entry.action],
        targetId: entry.queueName,
        metadata: auditMetadataSchema.parse(entry.metadata ?? {}),
      },
    });
  }
}
