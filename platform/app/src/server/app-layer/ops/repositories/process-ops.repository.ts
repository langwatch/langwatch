import type { ProcessRef } from "@langwatch/eventing";

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
  status: "pending" | "dispatched" | "dead" | "discarded";
  attempts: number;
  nextAttemptAt: number;
  leasedUntil: number | null;
  createdAt: number;
  sourceEventId: string | null;
  /** Parsed from the message's stored W3C carrier; null when absent/unparsable. */
  traceId: string | null;
  payload: unknown;
}

/**
 * A retired message, with the identity needed to act on it.
 *
 * `findOutboxMessages` answers for one instance, which means an operator can
 * only reach a dead message by already knowing which process key it belongs
 * to — and the fleet table only ever showed them a count. This view is the
 * fleet-wide read: it carries the full ref so a row can be redriven straight
 * from the list, and the trace id so the operator can reach the failure
 * itself. WHY it died is in the attempt history (`findAttempts`); `traceId`
 * remains the deeper join to the producing trace.
 */
export interface DeadOutboxMessageView extends ProcessOutboxMessageView {
  processName: string;
  projectId: string;
  processKey: string;
  /** Last write to the row, which for a dead row is when it was retired. */
  updatedAt: number;
}

/** One process's share of the dead total, for the fleet-level summary. */
export interface DeadLetterCount {
  processName: string;
  count: number;
  /** Oldest retirement in this group, so the operator can age the incident. */
  oldestUpdatedAt: number;
}

/**
 * One FAILED delivery attempt of an outbox message, oldest first — why a
 * dead letter died, on the page (specs/ops/dead-letter-recovery.feature).
 */
export interface OutboxAttemptView {
  /**
   * Row identity, not the attempt number. A redrive resets `attempts` to 0,
   * so a message that failed, was redriven, and failed again holds two
   * entries numbered 1 — the number is not unique over a message's life.
   */
  id: string;
  attempt: number;
  occurredAt: number;
  /** "dead" marks the failure that killed the message. */
  outcome: "retry_scheduled" | "dead";
  errorType: string;
  errorMessage: string;
  retryAfterMs: number | null;
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
   * Every retired message across the fleet, newest retirement first.
   * `processName` narrows to one process; omit it for everything.
   */
  findDeadMessages(params: {
    processName?: string;
    page: number;
    pageSize: number;
  }): Promise<{ messages: DeadOutboxMessageView[]; total: number }>;

  /** Dead totals per process, for the summary and the navigation badge. */
  countDeadByProcessName(): Promise<DeadLetterCount[]>;

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
   * One dead message marked never-to-be-sent. A mark, not a delete: the row
   * is retained as its own audit trail and the dispatcher never leases a
   * discarded row. Returns the message key for the audit trail, or null when
   * the message was not dead (or not that instance's).
   */
  discardDeadMessage(params: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null>;

  /**
   * Dead messages back to pending with a fresh budget — narrowed to one
   * process name, or every process when omitted.
   *
   * BOUNDED, not exhaustive: an implementation moves at most one batch per
   * call, because an unbounded UPDATE holds row locks on the highest-volume
   * table in the system for as long as it runs. The returned count is what
   * actually moved, so a caller wanting the rest calls again — and an
   * operator pressing the button again is exactly that.
   *
   * Due times are spread rather than set to a single instant: releasing
   * thousands of intents all due now hands the dispatcher one batch the size
   * of the backlog.
   */
  redriveAllDeadMessages(params: {
    processName?: string;
    now: number;
  }): Promise<number>;

  /**
   * Dead messages marked discarded; same scoping, and bounded the same way.
   */
  discardAllDeadMessages(params: {
    processName?: string;
    now: number;
  }): Promise<number>;

  /** The message's failed attempts, oldest first. */
  findAttempts(params: {
    outboxId: string;
    projectId: string;
  }): Promise<OutboxAttemptView[]>;

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
  async findDeadMessages(): Promise<{
    messages: DeadOutboxMessageView[];
    total: number;
  }> {
    return { messages: [], total: 0 };
  }
  async countDeadByProcessName(): Promise<DeadLetterCount[]> {
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
  async discardDeadMessage(): Promise<null> {
    return null;
  }
  async redriveAllDeadMessages(): Promise<number> {
    return 0;
  }
  async discardAllDeadMessages(): Promise<number> {
    return 0;
  }
  async findAttempts(): Promise<OutboxAttemptView[]> {
    return [];
  }
  async releaseLapsedLease(): Promise<null> {
    return null;
  }
}
