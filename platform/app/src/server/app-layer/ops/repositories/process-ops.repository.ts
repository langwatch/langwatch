import type { ProcessRef } from "~/server/event-sourcing/process-manager/processManager.types";

/**
 * Fleet-level trouble counts for one process name — the row the operator
 * scans first. Everything is a count of a state the tables can be in; the
 * meanings are pinned in dev/docs/ops-process-manager-visibility-plan.md.
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

export interface ProcessInstanceRow {
  processName: string;
  projectId: string;
  processKey: string;
  tenantId: string;
  revision: number;
  nextWakeAt: number | null;
  updatedAt: number;
  pendingMessages: number;
  deadMessages: number;
}

/** One upcoming instance wake, for the dashboard's timed-work table. */
export interface ProcessWakeRow {
  processName: string;
  projectId: string;
  processKey: string;
  nextWakeAt: number;
}

export interface ProcessOutboxMessageView {
  id: string;
  messageKey: string;
  intentType: string;
  status: "pending" | "dispatched" | "dead";
  attempts: number;
  nextAttemptAt: number;
  leasedUntil: number | null;
  createdAt: number;
  sourceEventId: string | null;
  /** Parsed from the message's stored W3C carrier; null when absent/unparsable. */
  traceId: string | null;
  payload: unknown;
}

export interface ProcessOpsRepository {
  countByProcessName(params: {
    now: number;
    overdueWakeMs: number;
    overduePendingMs: number;
  }): Promise<ProcessNameCounts[]>;

  findInstances(params: {
    /** Omit to list instances across EVERY process manager. */
    processName?: string;
    page: number;
    pageSize: number;
    /** Case-insensitive contains-match on the process key. */
    search?: string;
  }): Promise<{ instances: ProcessInstanceRow[]; total: number }>;

  /** The soonest-due instance wakes across every process, for the dashboard. */
  findUpcomingWakes(params: { limit: number }): Promise<ProcessWakeRow[]>;

  findOutboxMessages(params: {
    ref: ProcessRef;
    page: number;
    pageSize: number;
  }): Promise<{ messages: ProcessOutboxMessageView[]; total: number }>;

  /**
   * Set the instance's next wake to now. Returns the previous wake time (for
   * the audit trail) or null when the instance does not exist.
   */
  wakeInstanceNow(params: {
    ref: ProcessRef;
    now: number;
  }): Promise<{ woke: boolean; previousWakeAt: number | null }>;

  /**
   * One dead message back to pending, due immediately, attempts reset —
   * mirroring the store's instance-level requeue. The ref scopes the write
   * (tenancy carried on every mutation); returns the message key for the
   * audit trail, or null when it was not dead (or not that instance's).
   */
  redriveDeadMessage(params: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null>;

  /**
   * Clear a LAPSED lease so the dispatcher can pick the message up now
   * instead of waiting out the lease. Guarded in the write itself: only a
   * pending message whose lease already expired is touched, so a live
   * delivery's lease can never be released from under it. Returns the
   * message key for the audit trail, or null when nothing matched.
   */
  releaseLapsedLease(params: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null>;
}

/** For app presets that run without Postgres. */
export class NullProcessOpsRepository implements ProcessOpsRepository {
  async countByProcessName(): Promise<ProcessNameCounts[]> {
    return [];
  }
  async findInstances(): Promise<{
    instances: ProcessInstanceRow[];
    total: number;
  }> {
    return { instances: [], total: 0 };
  }
  async findUpcomingWakes(): Promise<ProcessWakeRow[]> {
    return [];
  }
  async findOutboxMessages(): Promise<{
    messages: ProcessOutboxMessageView[];
    total: number;
  }> {
    return { messages: [], total: 0 };
  }
  async wakeInstanceNow(): Promise<{
    woke: boolean;
    previousWakeAt: number | null;
  }> {
    return { woke: false, previousWakeAt: null };
  }
  async redriveDeadMessage(): Promise<null> {
    return null;
  }
  async releaseLapsedLease(): Promise<null> {
    return null;
  }
}
