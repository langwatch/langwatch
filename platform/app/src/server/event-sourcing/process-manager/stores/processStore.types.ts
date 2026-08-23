import type { JsonValue } from "../json";
import type { ProcessRef } from "../processManager.types";

/**
 * Persistence port for process-manager state, inbox, and outbox
 * (ADR-049 §5: ProcessManagerInbox / ProcessManagerInstance /
 * ProcessManagerOutbox). The port owns the atomic-commit semantics: one
 * `commit` call must apply the inbox marker, the state transition, the
 * wake-up, and the outbox inserts together, or not at all. Durable adapters
 * also own exclusive leasing; the in-memory test adapter is atomic per call.
 *
 * No infrastructure types (Prisma or otherwise) may appear in these
 * contracts.
 */
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
   * Delivery attempts STARTED so far — incremented at lease time, not at
   * acknowledgement. Counting starts instead of conclusions is what lets a
   * message whose lease keeps lapsing (handler never acknowledges) cross
   * `maxAttempts` and retire, instead of redelivering as attempt 1 forever.
   * A message released un-attempted by `releaseLease` hands its increment
   * back.
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
  /**
   * Inbox identity: (processName, projectId, sourceEventId) is consumed at
   * most once. Null for wake-driven commits, which are guarded by
   * `expectedRevision` instead.
   *
   * Any length is accepted. A store that enforces the uniqueness in an index
   * derives a fixed-width key from this value rather than indexing it
   * (`stores/inboxKey.ts`), so a caller's idempotency key can be as long as its
   * own domain needs.
   */
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

/**
 * The transient append: intents only, no instance row, no inbox row, and no
 * transaction.
 *
 * `commit` is transactional because it has something to lose. It writes an
 * inbox marker AND outbox messages, and the damaging interleaving is real: a
 * marker that lands without its messages says the event was consumed while
 * nothing was ever enqueued, which is silent loss. The other order is
 * harmless — messages without a marker are redelivered, re-derive the same
 * keys, and are suppressed.
 *
 * An evolution that keeps no state has nothing to lose in the first place.
 * Its outbox `messageKey` is already a pure function of the event (the
 * builder qualifies every key with the process key), so the outbox's own
 * uniqueness IS the consumption record, and a second marker for the same fact
 * buys nothing. What is left is a set of idempotent inserts, which need no
 * lock, no compare-and-swap, and no transaction to be correct under crash,
 * redelivery, or two workers racing the same event.
 *
 * The contract that replaces the transaction: every `messageKey` handed here
 * MUST be derivable from the event alone. A key built from a clock or a
 * random value cannot be re-derived by a redelivery, which turns the
 * suppression into a duplicate side effect. `processTransientKeys` in the
 * pipeline test suite holds definitions to that rule.
 */
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

  /** Atomically: consume inbox row, bump revision, persist state + wake, insert deduped messages. */
  commit<State = unknown>(commit: ProcessCommit<State>): Promise<CommitResult>;

  /**
   * Appends a transient evolution's intents. See {@link AppendIntentsResult}
   * for why this is neither transactional nor inbox-backed.
   *
   * Idempotent: a key that already exists is reported as duplicate rather
   * than inserted, so a partial write followed by a redelivery converges on
   * exactly the intended set.
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
  findMessagesByRef(params: {
    ref: ProcessRef;
  }): Promise<OutboxMessageRecord[]>;

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
     * Restrict leasing to these processNames. The outbox table is shared
     * across every process manager, so each domain's dispatcher MUST scope
     * its leases — an unfiltered dispatcher would lease another domain's
     * intents, fail to find a handler, and retry-churn them (ADR-051 §4).
     * Omitted means unfiltered (single-domain deployments and tests).
     */
    processNames?: readonly string[];
  }): Promise<LeasedOutboxMessageRecord[]>;

  /**
   * `applied: false` means the update matched no row: the lease lapsed and
   * a newer token superseded this one. Callers must surface that — a fenced
   * acknowledgement means the effect may have run more than once and the
   * message is still pending under someone else's lease.
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
   * Return a leased message to the pool WITHOUT running it: clears the lease
   * and hands back the attempt the lease charged, leaving the row
   * immediately due. For batch tails whose lease budget ran out before their
   * delivery started — releasing instead of dispatching is what keeps a slow
   * batch from ever running past its own lease.
   */
  releaseLease(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
  }): Promise<{ applied: boolean }>;

  /** Processes whose nextWakeAt is due, with the revision to guard against staleness. */
  findDueWakes(params: {
    now: number;
    limit: number;
    /** Restrict the global wake scan to process managers mounted here. */
    processNames?: readonly string[];
  }): Promise<DueWake[]>;

  /**
   * Retention for high-frequency recurring intents (ADR-052): deletes
   * DISPATCHED outbox rows of one processName whose dispatch finished
   * before `before`. Pending/dead rows are never touched — dead rows are
   * the operator's failure record, pending rows are work. Returns the
   * deleted count.
   */
  deleteDispatchedBefore(params: {
    processName: string;
    before: number;
  }): Promise<number>;

  /**
   * Retention sweep, dispatched family: delete at most `limit` DISPATCHED
   * outbox rows whose dispatch finished before `before`, ACROSS EVERY
   * processName and project. Returns the deleted count.
   *
   * The absent processName predicate is the point. `deleteDispatchedBefore`
   * above reaps one named process, so a process manager is only covered if
   * somebody remembered to register a prune for it, and half of them never
   * were. Reaping by predicate covers every process manager that exists and
   * every one added later, with no registration step to forget.
   *
   * A returned count below `limit` means the family is drained, which is how
   * a caller's drain loop knows to stop.
   */
  deleteDispatchedOutboxBatch(params: {
    before: number;
    limit: number;
  }): Promise<number>;

  /**
   * Retention sweep, dead family: delete at most `limit` DEAD outbox rows
   * last touched before `before`, across every processName and project.
   * Dead rows are the operator's failure record, so callers give this a far
   * longer window than the dispatched family.
   */
  deleteDeadOutboxBatch(params: {
    before: number;
    limit: number;
  }): Promise<number>;

  /**
   * Retention sweep, inbox family: delete at most `limit` inbox rows consumed
   * before `before`, across every processName and project.
   *
   * An inbox row is an idempotency marker, so the window only has to outlive
   * the horizon in which the same source event can be redelivered. See
   * specs/event-sourcing/process-manager-retention.feature for why that
   * horizon is about 25 hours.
   */
  deleteConsumedInboxBatch(params: {
    before: number;
    limit: number;
  }): Promise<number>;

  /**
   * Dead-letter recovery: flip DEAD rows of one process back to pending
   * with a fresh attempt budget, due immediately. Scoped by processKey
   * (one process instance's rows) and optionally narrowed by messageKey
   * prefix so an operator can requeue one endpoint's batches without
   * resurrecting every failure in the domain. Returns the requeued count.
   */
  requeueDeadMessages(params: {
    processName: string;
    projectId: string;
    processKey: string;
    messageKeyPrefix?: string;
    now: number;
  }): Promise<number>;
}
