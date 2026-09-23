import type { ProcessRef } from "@langwatch/eventing";
// One definition of what the operator sees, shared with the port the
// transport calls — see `@langwatch/ops-contract`'s ops-process module.
import type {
  DeadLetterCount,
  DeadOutboxMessageView,
  OutboxAttemptView,
  ProcessInstanceRow,
  ProcessOutboxMessageView,
  ProcessWakeRow,
} from "@langwatch/ops-contract";

/**
 * Fleet-level trouble counts for one process name — the row the operator
 * scans first. Everything is a count of a state the tables can be in; the
 * meanings are pinned in dev/docs/plans/ops-process-manager-visibility-plan.md.
 */
export interface ProcessNameCounts {
  processName: string;
  instances: number;
  /** Instances whose next wake is past due by more than the threshold. */
  overdueWakes: number;
  pendingMessages: number;
  /** Pending messages whose next attempt is long past and unleased. */
  overduePending: number;
  /** Pending messages whose lease expired — dispatcher died OR still delivering. */
  lapsedLeases: number;
  deadMessages: number;
}

export abstract class ProcessOpsRepository {
  abstract countByProcessName(params: {
    now: number;
    overdueWakeMs: number;
    overduePendingMs: number;
  }): Promise<ProcessNameCounts[]>;

  abstract findInstances(params: {
    /** Omit to list instances across EVERY process manager. */
    processName?: string;
    page: number;
    pageSize: number;
    /** Case-insensitive contains-match on the process key. */
    search?: string;
  }): Promise<{ instances: ProcessInstanceRow[]; total: number }>;

  /** The soonest-due instance wakes across every process, for the dashboard. */
  abstract findUpcomingWakes(params: { limit: number }): Promise<ProcessWakeRow[]>;

  abstract findOutboxMessages(params: {
    ref: ProcessRef;
    page: number;
    pageSize: number;
  }): Promise<{ messages: ProcessOutboxMessageView[]; total: number }>;

  /**
   * Every retired message across the fleet, newest retirement first.
   * `processName` narrows to one process; omit it for everything.
   */
  abstract findDeadMessages(params: {
    processName?: string;
    page: number;
    pageSize: number;
  }): Promise<{ messages: DeadOutboxMessageView[]; total: number }>;

  /** Dead totals per process, for the summary and the navigation badge. */
  abstract countDeadByProcessName(): Promise<DeadLetterCount[]>;

  /**
   * Set the instance's next wake to now. Returns the previous wake time (for
   * the audit trail) or null when the instance does not exist.
   */
  abstract wakeInstanceNow(params: {
    ref: ProcessRef;
    now: number;
  }): Promise<{ woke: boolean; previousWakeAt: number | null }>;

  /**
   * One dead message back to pending, due immediately, attempts reset -
   * mirroring the store's instance-level requeue. Returns the message key
   * for the audit trail, or null when it was not dead (or not that instance's).
   */
  abstract tryRedriveDeadMessage(params: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null>;

  /**
   * One dead message marked never-to-be-sent. A mark, not a delete: the row
   * is retained as its own audit trail and the dispatcher never leases a
   * discarded row. Returns the message key, or null when it was not dead.
   */
  abstract tryDiscardDeadMessage(params: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null>;

  /** Redrive dead messages with fresh budget, BOUNDED per batch to avoid
   * row-lock contention on the highest-volume table. */
  abstract redriveAllDeadMessages(params: { processName?: string; now: number }): Promise<number>;

  /**
   * Dead messages marked discarded; same scoping, and bounded the same way.
   */
  abstract discardAllDeadMessages(params: { processName?: string; now: number }): Promise<number>;

  /** The message's failed attempts, oldest first. */
  abstract findAttempts(params: {
    outboxId: string;
    projectId: string;
  }): Promise<OutboxAttemptView[]>;

  /**
   * Clear a LAPSED lease so the dispatcher can pick the message up now.
   * Guarded in the write itself: only a pending message whose lease already
   * expired is touched, so a live delivery's lease can never be released.
   */
  abstract tryReleaseLapsedLease(params: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null>;
}
