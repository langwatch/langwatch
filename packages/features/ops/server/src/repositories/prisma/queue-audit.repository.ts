import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";

export type QueueControlAction =
  | "queue_redrive_dlq_groups"
  | "queue_discard_dlq_groups"
  | "queue_drain_group"
  | "queue_drain_tenant"
  | "queue_move_group_to_dlq"
  | "queue_move_all_blocked_to_dlq"
  | "queue_unblock_group"
  | "queue_unblock_all";

/**
 * Audit sink for GroupQueue operator actions
 * (specs/ops/dead-letter-recovery.feature). The Redis substrate forgets DLQ
 * entries at their TTL, so for a discard THIS row is the retained mark: the
 * queue, the groups, how many jobs they held, and their last errors survive
 * here after the entries themselves are gone.
 *
 * The same holds for a drain, which removes jobs outright. Every act that
 * removes or relocates work carries a name here, because an act the log
 * cannot name is an act that did not happen as far as anyone reading it
 * later is concerned.
 */
export interface QueueAuditSink {
  append(entry: {
    actorUserId: string;
    action: QueueControlAction;
    queueName: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

const auditMetadataSchema = z.record(z.string(), z.json());

/**
 * The audit log's target kinds for these acts, keyed by action.
 *
 * A drain or an unblock operates on the live queue, not on its dead-letter
 * side, so filing them under `queue_dlq` would put them in front of an
 * operator filtering for dead-letter activity and hide them from one
 * filtering for the queue. Derived from the action rather than fixed, so the
 * two dead-letter acts keep the kind they have always written and nothing
 * already filtering on it is reclassified underneath.
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
        targetKind: TARGET_KIND_BY_ACTION[entry.action],
        targetId: entry.queueName,
        metadata: auditMetadataSchema.parse(entry.metadata ?? {}),
      },
    });
  }
}
