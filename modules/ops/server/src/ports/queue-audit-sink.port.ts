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
 * Audit sink for GroupQueue operator actions (specs/ops/dead-letter-recovery.feature). The Redis substrate forgets
 * DLQ entries at their TTL, so for a discard THIS row is the retained mark: the queue, the groups, how many jobs
 * they held, and their last errors survive here after the entries themselves are gone.
 */
export abstract class QueueAuditSinkPort {
  abstract append(entry: {
    actorUserId: string;
    action: QueueControlAction;
    queueName: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

/** For app presets that run without Postgres. */
export class NullQueueAuditSink extends QueueAuditSinkPort {
  private constructor() {
    super();
  }

  static create(): NullQueueAuditSink {
    return new NullQueueAuditSink();
  }

  async append(): Promise<void> {}
}
