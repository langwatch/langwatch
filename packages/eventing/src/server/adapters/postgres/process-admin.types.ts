import type { OutboxMessageStatus } from "../../../process-manager/stores/processStore.types.ts";

/**
 * What the operator surface over the process-manager tables answers (ARCHITECTURE.md §7, ET-1):
 * eventing owns the rows, so it owns their shapes; ops publishes them on its own wire.
 * Spec: packages/eventing/specs/event-table-surfaces.feature.
 */

/** Fleet trouble counts for one process name; the meanings are a count of a table state. */
export interface ProcessNameCounts {
  processName: string;
  instances: number;
  /** Instances whose next wake is past due by more than the threshold. */
  overdueWakes: number;
  pendingMessages: number;
  /** Pending messages whose next attempt is long past and unleased. */
  overduePending: number;
  /** Pending messages whose lease expired: the dispatcher died, or it is still delivering. */
  lapsedLeases: number;
  deadMessages: number;
}

/** One instance of a process manager, as the fleet table lists it. */
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

/** One upcoming instance wake. */
export interface ProcessWakeRow {
  processName: string;
  projectId: string;
  processKey: string;
  nextWakeAt: number;
}

/** One message in an instance's transactional outbox. */
export interface ProcessOutboxMessageView {
  id: string;
  messageKey: string;
  intentType: string;
  status: OutboxMessageStatus;
  attempts: number;
  nextAttemptAt: number;
  leasedUntil: number | null;
  createdAt: number;
  sourceEventId: string | null;
  /** Parsed from the message's stored W3C carrier; null when absent or unparsable. */
  traceId: string | null;
  payload: unknown;
}

/** A retired message, with the full ref so it can be acted on from a list. */
export interface DeadOutboxMessageView extends ProcessOutboxMessageView {
  processName: string;
  projectId: string;
  processKey: string;
  /** Last write to the row, which for a dead row is when it was retired. */
  updatedAt: number;
}

/** One process's share of the dead total. */
export interface DeadLetterCount {
  processName: string;
  count: number;
  /** Oldest retirement in this group. */
  oldestUpdatedAt: number;
}

/** One failed delivery attempt of an outbox message. */
export interface OutboxAttemptView {
  /** Row identity: a redrive resets the attempt number, so the number is not unique. */
  id: string;
  attempt: number;
  occurredAt: number;
  /** "dead" marks the failure that killed the message. */
  outcome: "retry_scheduled" | "dead";
  errorType: string;
  errorMessage: string;
  retryAfterMs: number | null;
}

export type DeadMessageRedrive = { kind: "redriven"; messageKey: string } | { kind: "not_dead" };
export type DeadMessageDiscard = { kind: "discarded"; messageKey: string } | { kind: "not_dead" };
export type LapsedLeaseRelease = { kind: "released"; messageKey: string } | { kind: "not_lapsed" };

/** The retention targets the operator's purge clears, named the way its report names them. */
export type ProcessPurgeTarget = "outbox-dispatched" | "inbox-consumed";
