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

export type OutboxMessageStatus = "pending" | "dispatched" | "dead";

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
  /** Completed delivery attempts so far. */
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

  /** All messages for one process, primarily for diagnostics and tests. */
  findMessagesByRef(params: { ref: ProcessRef }): Promise<OutboxMessageRecord[]>;

  /**
   * Lease pending, due messages for exclusive dispatch until
   * `now + leaseDurationMs`.
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

  markDispatched(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
  }): Promise<void>;

  /** Record a failed attempt; `dead: true` retires the message permanently. */
  markFailed(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
    nextAttemptAt: number;
    dead: boolean;
  }): Promise<void>;

  /** Processes whose nextWakeAt is due, with the revision to guard against staleness. */
  findDueWakes(params: { now: number; limit: number }): Promise<DueWake[]>;
}
