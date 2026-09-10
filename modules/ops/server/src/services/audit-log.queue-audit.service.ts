import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { z } from "zod";
import { QueueAuditSink, type QueueControlAction } from "../app/ops.app.ts";

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

/** Records queue dead-letter operator actions on the shared audit log. */
export class QueueAuditAdapter extends QueueAuditSink {
  static create({ auditLog }: { auditLog: AuditLogApi }): QueueAuditAdapter {
    return new QueueAuditAdapter(auditLog);
  }

  private constructor(private readonly auditLog: AuditLogApi) {
    super();
  }

  async append(entry: {
    actorUserId: string;
    action: QueueControlAction;
    queueName: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    // Queues are cross-project worker members; there is no single
    // project to scope the act to, and inventing one would mislead.
    await this.auditLog.record({
      userId: entry.actorUserId,
      action: entry.action,
      targetKind: TARGET_KIND_BY_ACTION[entry.action],
      targetId: entry.queueName,
      metadata: auditMetadataSchema.parse(entry.metadata ?? {}),
    });
  }
}
