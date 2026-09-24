import type { JsonValue } from "../json.ts";
import type { ProcessRef } from "../processManager.types.ts";

/** Persistence port for process-manager state, inbox, and outbox with atomic-commit semantics. */
export interface PersistedProcessInstance<State = unknown> {
  ref: ProcessRef;
  tenantId: string;
  userId?: string;
  state: State;
  /** Monotonic optimistic-concurrency counter; 1 after the first commit. */
  revision: number;
  /** Epoch ms of the next due wake-up, or null when none is scheduled. */
  nextWakeAt: number | null;
  updatedAt: number;
}

export type OutboxMessageStatus =
  | "pending"
  | "dispatched"
  | "dead"
  /** Operator-marked never-to-be-sent (specs/ops/dead-letter-recovery.feature).
   *  A mark, not a delete: the row stays as its own audit trail. */
  | "discarded";

/**
 * One FAILED delivery attempt, recorded so a dead letter can say why it died
 * without a span lookup (specs/ops/dead-letter-recovery.feature). Successes
 * write nothing.
 */
export interface FailedOutboxAttempt {
  /** 1-based attempt number, as the dispatcher counts it. */
  attempt: number;
  occurredAt: number;
  /** Whether this failure retired the message or scheduled a retry. */
  outcome: "retry_scheduled" | "dead";
  errorType: string;
  /** The safe failure diagnostic — never a raw provider body. */
  errorMessage: string;
  retryAfterMs?: number;
}

export interface NewOutboxMessage {
  messageKey: string;
  intentType: string;
  payload: JsonValue;
  /**
   * Full W3C propagation carrier (traceparent/tracestate/baggage as
   * configured) captured with propagation.inject at commit time.
   */
  traceCarrier: Record<string, string>;
  userId?: string;
}

export interface OutboxMessageRecord extends NewOutboxMessage {
  processName: string;
  projectId: string;
  processKey: string;
  tenantId: string;
  /** The inbox identity that produced this intent; null for wake commits. */
  sourceEventId: string | null;
  status: OutboxMessageStatus;
  /**
   * Delivery attempts STARTED so far, incremented at lease time (not ack) —
   * so a message whose lease keeps lapsing without an ack still crosses
   * `maxAttempts` and retires. `releaseLease` refunds the increment.
   */
  attempts: number;
  /** Epoch ms before which the message must not be leased. */
  nextAttemptAt: number;
  /** Current exclusive lease capability, or null while unleased. */
  leaseToken: string | null;
  createdAt: number;
}

/** A message returned from leaseDueMessages always has a fencing token. */
export interface LeasedOutboxMessageRecord extends OutboxMessageRecord {
  leaseToken: string;
}

export interface ProcessCommit<State = unknown> {
  ref: ProcessRef;
  tenantId: string;
  userId?: string;
  /** Inbox identity for idempotency; null for wake-driven commits guarded by expectedRevision. */
  sourceEventId: string | null;
  /** 0 when the process has never been committed. */
  expectedRevision: number;
  state: State;
  nextWakeAt: number | null;
  messages: NewOutboxMessage[];
  now: number;
}

export type CommitResult =
  | {
      outcome: "committed";
      revision: number;
      insertedMessageKeys: string[];
      /** Message keys skipped because (processName, projectId, messageKey) already exists. */
      duplicateMessageKeys: string[];
    }
  | { outcome: "duplicateEvent" }
  | { outcome: "revisionConflict"; actualRevision: number };

/** Transient append: intents only; deterministic messageKeys required. */
export interface AppendIntentsResult {
  insertedMessageKeys: string[];
  duplicateMessageKeys: string[];
}

/** Identity of one outbox message within its uniqueness contract. */
export interface OutboxMessageIdentity {
  processName: string;
  projectId: string;
  messageKey: string;
}

export interface DueWake {
  ref: ProcessRef;
  /** Process revision the wake-up was scheduled at; stale if it moved on. */
  revision: number;
  wakeAt: number;
}

export interface ProcessStore {
  findByRef<State = unknown>(params: {
    ref: ProcessRef;
  }): Promise<PersistedProcessInstance<State> | null>;

  /**
   * Checks the inbox identity before pure evolution — `commit` remains the
   * authoritative atomic dedup fence, but this read lets a synchronous retry
   * return the already-committed state without re-running the transition.
   */
  hasConsumedSource(params: { ref: ProcessRef; sourceEventId: string }): Promise<boolean>;

  /** Atomically consume inbox, bump revision, persist state + wake, and insert messages. */
  commit<State = unknown>(commit: ProcessCommit<State>): Promise<CommitResult>;

  /**
   * Appends a transient evolution's intents (see {@link AppendIntentsResult}
   * for why this is neither transactional nor inbox-backed). Idempotent — an
   * existing key reports as duplicate, so a partial write plus redelivery still converges.
   */
  appendIntents(params: {
    ref: ProcessRef;
    tenantId: string;
    userId?: string;
    /** Recorded on each row for diagnostics; nothing keys off it here. */
    sourceEventId: string | null;
    messages: NewOutboxMessage[];
    now: number;
  }): Promise<AppendIntentsResult>;

  /** All messages for one process, primarily for diagnostics and tests. */
  findMessagesByRef(params: { ref: ProcessRef }): Promise<OutboxMessageRecord[]>;

  /**
   * Lease pending, due messages for exclusive dispatch until
   * `now + leaseDurationMs`. Leasing increments `attempts` — the returned
   * records carry the attempt number of the delivery that is about to start.
   */
  leaseDueMessages(params: {
    now: number;
    limit: number;
    leaseDurationMs: number;
    /**
     * Restrict leasing to these processNames. Each dispatcher MUST scope its
     * leases (ADR-051 §4) — unfiltered, it would lease another domain's
     * intents, fail to find a handler, and retry-churn them.
     */
    processNames?: readonly string[];
  }): Promise<LeasedOutboxMessageRecord[]>;

  /**
   * `applied: false` means the update matched no row — the lease lapsed and
   * a newer token superseded it. Callers must surface that: a fenced ack
   * means the effect may have run twice and the message is still pending.
   */
  markDispatched(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
  }): Promise<{ applied: boolean }>;

  /** Record a failed attempt; `dead: true` retires the message permanently. */
  markFailed(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
    nextAttemptAt: number;
    dead: boolean;
  }): Promise<{ applied: boolean }>;

  /**
   * Append one failed attempt to the message's history. Best-effort by
   * contract: callers wrap it so a history write that fails never fails the
   * delivery accounting (the attempt entry is the only loss).
   */
  recordFailedAttempt(params: {
    identity: OutboxMessageIdentity;
    attempt: FailedOutboxAttempt;
  }): Promise<void>;

  /**
   * Return a leased message to the pool WITHOUT running it, clearing the
   * lease and refunding the attempt it charged. For a batch tail whose lease
   * budget ran out before delivery — this keeps it from outrunning its lease.
   */
  releaseLease(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
  }): Promise<{ applied: boolean }>;

  /** Every instance key of one process across the named projects; empty when none exist. */
  findProcessKeys(params: { processName: string; projectIds: readonly string[] }): Promise<string[]>;

  /** Processes whose nextWakeAt is due, with the revision to guard against staleness. */
  findDueWakes(params: {
    now: number;
    limit: number;
    /** Restrict the global wake scan to process managers mounted here. */
    processNames?: readonly string[];
  }): Promise<DueWake[]>;

  /**
   * Retention for high-frequency recurring intents (ADR-052): deletes
   * DISPATCHED rows of one processName finished before `before`. Pending/dead
   * rows are never touched — dead is the operator's failure record, pending is work.
   */
  deleteDispatchedBefore(params: { processName: string; before: number }): Promise<number>;

  /** Retention sweep: delete dispatched rows across all processes. */
  deleteDispatchedOutboxBatch(params: { before: number; limit: number }): Promise<number>;

  /**
   * Retention sweep, dead family: delete at most `limit` DEAD outbox rows
   * last touched before `before`, across every processName and project —
   * dead rows are the operator's failure record, so callers use a far longer window.
   */
  deleteDeadOutboxBatch(params: { before: number; limit: number }): Promise<number>;

  /** Retention sweep: delete consumed inbox rows within the redelivery horizon. */
  deleteConsumedInboxBatch(params: { before: number; limit: number }): Promise<number>;

  /**
   * Dead-letter recovery: flip DEAD rows of one process back to pending with
   * a fresh attempt budget, due immediately. Scoped by processKey, optionally
   * narrowed by messageKey prefix to requeue one endpoint without the whole domain.
   */
  requeueDeadMessages(params: {
    processName: string;
    projectId: string;
    processKey: string;
    messageKeyPrefix?: string;
    now: number;
  }): Promise<number>;
}
