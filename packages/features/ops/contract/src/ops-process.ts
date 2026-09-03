import { z } from "zod";

/** One process manager's registry identity joined to its live trouble counts. */
export interface ProcessFleetSummary {
  processName: string;
  pipelineName: string;
  scheduled: boolean;
  instances: number;
  overdueWakes: number;
  pendingMessages: number;
  overduePending: number;
  lapsedLeases: number;
  deadMessages: number;
}

/** One process ref, the triple every process-manager read is keyed by. */
export const opsProcessRefInputSchema = z.object({
  processName: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  processKey: z.string().min(1).max(500),
});

/** One message inside one process instance's outbox. */
export const opsProcessMessageInputSchema = opsProcessRefInputSchema.extend({
  messageId: z.string().min(1).max(64),
});

export const opsAggregateProcessManagersInputSchema = z.object({
  aggregateType: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  aggregateId: z.string().min(1).max(500),
});

export const opsRequeueDeadOutboxMessagesInputSchema = z.object({
  processName: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  processKey: z.string().min(1).max(500),
  messageKeyPrefix: z.string().min(1).max(500).optional(),
});

export const opsListDeadLettersInputSchema = z.object({
  /** Omit for every process. */
  processName: z.string().min(1).max(200).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export const opsListProcessInstancesInputSchema = z.object({
  /** Omit to list instances across every process manager. */
  processName: z.string().min(1).max(200).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().max(500).optional(),
});

export const opsListUpcomingWakesInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(20),
});

export const opsListProcessOutboxInputSchema = opsProcessRefInputSchema.extend({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const opsListProcessActionsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

export const opsRedriveDeadLettersInputSchema = z.object({
  processName: z.string().min(1).max(200).optional(),
});

/**
 * The fleet-wide discard — no `processName` — crosses every tenant and cannot
 * be undone, since no redrive path selects a discarded row. It therefore takes
 * a typed confirmation: the destructive breadth has to be reached
 * deliberately, not by omitting a field.
 */
export const opsDiscardDeadLettersInputSchema = z
  .object({
    processName: z.string().min(1).max(200).optional(),
    confirm: z.literal("DISCARD ALL").optional(),
  })
  .refine((input) => !!input.processName || input.confirm !== undefined, {
    message: "Discarding every process's dead letters requires an explicit confirmation",
    path: ["confirm"],
  });

export const opsListOutboxAttemptsInputSchema = z.object({
  outboxId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(200),
});

// ---------------------------------------------------------------------------
// The process-manager explorer's vocabulary.
//
// It lived in `platform/app`, so `OpsProcessExplorer` — the port the operator
// transport calls — could only say `Promise<unknown>` for all twenty of its
// operations. Its own comment claimed "the concrete return types reach the
// client through the context type rather than through these shapes", and
// nothing did: `unknown` is what a tRPC procedure publishes, and `{}` is what
// the browser reads it back as. The dead-letter table, the fleet card, the
// wake list and the outbox panel were all reading fields off nothing.
// ---------------------------------------------------------------------------

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

/** One upcoming instance wake, for the dashboard's timed-work table. */
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
  status: "pending" | "dispatched" | "dead" | "discarded";
  attempts: number;
  nextAttemptAt: number;
  leasedUntil: number | null;
  createdAt: number;
  sourceEventId: string | null;
  /** Parsed from the message's stored W3C carrier; null when absent or unparsable. */
  traceId: string | null;
  payload: unknown;
}

/**
 * A retired message, with the identity needed to act on it.
 *
 * The fleet-wide read: it carries the full ref so a row can be redriven
 * straight from the list, and the trace id so the operator can reach the
 * failure itself.
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
 * One FAILED delivery attempt of an outbox message, oldest first — why a dead
 * letter died, on the page (specs/ops/dead-letter-recovery.feature).
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

/** One process-control act, as the audit trail keeps it. */
export interface ProcessAuditEntryView {
  id: string;
  createdAt: number;
  action: string;
  targetId: string;
  actorUserId: string | null;
  metadata: unknown;
}

/** Which instance of which process manager, in one value. */
export interface OpsProcessRefView {
  processName: string;
  projectId: string;
  processKey: string;
}

/** One instance in full, as the detail panel reads it. */
export interface ProcessInstanceDetail {
  ref: OpsProcessRefView;
  tenantId: string;
  state: unknown;
  revision: number;
  nextWakeAt: number | null;
  updatedAt: number;
}

/** The aggregate's current position in one manager's machine. */
export interface AggregateProcessManagerInstance {
  /**
   * The persisted state JSON. Deliberately identities-and-flags only — the
   * content boundary keeps customer payload out of it — so it is safe to
   * render directly.
   */
  state: unknown;
  /** Optimistic-concurrency counter; 1 after the first commit. */
  revision: number;
  /** Epoch ms of the next due wake-up, or null when none is scheduled. */
  nextWakeAt: number | null;
  updatedAt: number;
}

/** One cross-aggregate command this instance emitted, via the outbox. */
export interface AggregateProcessManagerOutboxMessage {
  messageKey: string;
  intentType: string;
  status: "pending" | "dispatched" | "dead" | "discarded";
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  /** The event that produced this intent; null for a wake-driven commit. */
  sourceEventId: string | null;
}

/** One process-manager state machine as it stands for a single aggregate. */
export interface AggregateProcessManager {
  processName: string;
  pipelineName: string;
  /** Event types that drive the machine's transitions. */
  eventTypes: readonly string[];
  /** Intent types the machine can emit — the commands it sends to other aggregates. */
  intentTypes: string[];
  hasWake: boolean;
  /** The aggregate's current position, or null if the machine never started for it. */
  instance: AggregateProcessManagerInstance | null;
  outbox: AggregateProcessManagerOutboxMessage[];
}
