/**
 * Audit sink for GroupQueue operator actions (specs/ops/dead-letter-recovery.feature).
 * Kept out of `ops.app.ts`: `OpsApp.create` reaches this sink's implementers via
 * `OpsOperations`, and a value import back into `ops.app.ts` would cycle.
 */
export type QueueControlAction =
  | "queue_redrive_dlq_groups"
  | "queue_discard_dlq_groups"
  | "queue_drain_group"
  | "queue_drain_tenant"
  | "queue_move_group_to_dlq"
  | "queue_move_all_blocked_to_dlq"
  | "queue_unblock_group"
  | "queue_unblock_all";

export abstract class QueueAuditSink {
  abstract append(entry: {
    actorUserId: string;
    action: QueueControlAction;
    queueName: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
