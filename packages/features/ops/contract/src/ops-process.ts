import { z } from "zod";

/** One process manager's registry identity joined to its live trouble counts. */
export const processFleetSummarySchema = z.object({
  processName: z.string(),
  pipelineName: z.string(),
  scheduled: z.boolean(),
  instances: z.number(),
  overdueWakes: z.number(),
  pendingMessages: z.number(),
  overduePending: z.number(),
  lapsedLeases: z.number(),
  deadMessages: z.number(),
});
export type ProcessFleetSummary = z.infer<typeof processFleetSummarySchema>;

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
export const processInstanceRowSchema = z.object({
  processName: z.string(),
  projectId: z.string(),
  processKey: z.string(),
  tenantId: z.string(),
  revision: z.number(),
  nextWakeAt: z.number().nullable(),
  updatedAt: z.number(),
  pendingMessages: z.number(),
  deadMessages: z.number(),
});
export type ProcessInstanceRow = z.infer<typeof processInstanceRowSchema>;

/** One upcoming instance wake, for the dashboard's timed-work table. */
export const processWakeRowSchema = z.object({
  processName: z.string(),
  projectId: z.string(),
  processKey: z.string(),
  nextWakeAt: z.number(),
});
export type ProcessWakeRow = z.infer<typeof processWakeRowSchema>;

/** What an outbox message can be, in the order a delivery moves through. */
export const processOutboxStatusSchema = z.enum(["pending", "dispatched", "dead", "discarded"]);

/** One message in an instance's transactional outbox. */
export const processOutboxMessageViewSchema = z.object({
  id: z.string(),
  messageKey: z.string(),
  intentType: z.string(),
  status: processOutboxStatusSchema,
  attempts: z.number(),
  nextAttemptAt: z.number(),
  leasedUntil: z.number().nullable(),
  createdAt: z.number(),
  sourceEventId: z.string().nullable(),
  /** Parsed from the message's stored W3C carrier; null when absent or unparsable. */
  traceId: z.string().nullable(),
  payload: z.unknown(),
});
export type ProcessOutboxMessageView = z.infer<typeof processOutboxMessageViewSchema>;

/**
 * A retired message, with the identity needed to act on it.
 *
 * The fleet-wide read: it carries the full ref so a row can be redriven
 * straight from the list, and the trace id so the operator can reach the
 * failure itself.
 */
export const deadOutboxMessageViewSchema = processOutboxMessageViewSchema.extend({
  processName: z.string(),
  projectId: z.string(),
  processKey: z.string(),
  /** Last write to the row, which for a dead row is when it was retired. */
  updatedAt: z.number(),
});
export type DeadOutboxMessageView = z.infer<typeof deadOutboxMessageViewSchema>;

/** One process's share of the dead total, for the fleet-level summary. */
export const deadLetterCountSchema = z.object({
  processName: z.string(),
  count: z.number(),
  /** Oldest retirement in this group, so the operator can age the incident. */
  oldestUpdatedAt: z.number(),
});
export type DeadLetterCount = z.infer<typeof deadLetterCountSchema>;

/**
 * One FAILED delivery attempt of an outbox message, oldest first — why a dead
 * letter died, on the page (specs/ops/dead-letter-recovery.feature).
 */
export const outboxAttemptViewSchema = z.object({
  /**
   * Row identity, not the attempt number. A redrive resets `attempts` to 0,
   * so a message that failed, was redriven, and failed again holds two
   * entries numbered 1 — the number is not unique over a message's life.
   */
  id: z.string(),
  attempt: z.number(),
  occurredAt: z.number(),
  /** "dead" marks the failure that killed the message. */
  outcome: z.enum(["retry_scheduled", "dead"]),
  errorType: z.string(),
  errorMessage: z.string(),
  retryAfterMs: z.number().nullable(),
});
export type OutboxAttemptView = z.infer<typeof outboxAttemptViewSchema>;

/** One process-control act, as the audit trail keeps it. */
export const processAuditEntryViewSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  action: z.string(),
  targetId: z.string(),
  actorUserId: z.string().nullable(),
  metadata: z.unknown(),
});
export type ProcessAuditEntryView = z.infer<typeof processAuditEntryViewSchema>;

/** Which instance of which process manager, in one value. */
export const opsProcessRefViewSchema = z.object({
  processName: z.string(),
  projectId: z.string(),
  processKey: z.string(),
});
export type OpsProcessRefView = z.infer<typeof opsProcessRefViewSchema>;

/** One instance in full, as the detail panel reads it. */
export const processInstanceDetailSchema = z.object({
  ref: opsProcessRefViewSchema,
  tenantId: z.string(),
  state: z.unknown(),
  revision: z.number(),
  nextWakeAt: z.number().nullable(),
  updatedAt: z.number(),
});
export type ProcessInstanceDetail = z.infer<typeof processInstanceDetailSchema>;

/** The aggregate's current position in one manager's machine. */
export const aggregateProcessManagerInstanceSchema = z.object({
  /**
   * The persisted state JSON. Deliberately identities-and-flags only — the
   * content boundary keeps customer payload out of it — so it is safe to
   * render directly.
   */
  state: z.unknown(),
  /** Optimistic-concurrency counter; 1 after the first commit. */
  revision: z.number(),
  /** Epoch ms of the next due wake-up, or null when none is scheduled. */
  nextWakeAt: z.number().nullable(),
  updatedAt: z.number(),
});
export type AggregateProcessManagerInstance = z.infer<typeof aggregateProcessManagerInstanceSchema>;

/** One cross-aggregate command this instance emitted, via the outbox. */
export const aggregateProcessManagerOutboxMessageSchema = z.object({
  messageKey: z.string(),
  intentType: z.string(),
  status: processOutboxStatusSchema,
  attempts: z.number(),
  nextAttemptAt: z.number(),
  createdAt: z.number(),
  /** The event that produced this intent; null for a wake-driven commit. */
  sourceEventId: z.string().nullable(),
});
export type AggregateProcessManagerOutboxMessage = z.infer<
  typeof aggregateProcessManagerOutboxMessageSchema
>;

/** One process-manager state machine as it stands for a single aggregate. */
export const aggregateProcessManagerSchema = z.object({
  processName: z.string(),
  pipelineName: z.string(),
  /** Event types that drive the machine's transitions. */
  eventTypes: z.array(z.string()).readonly(),
  /** Intent types the machine can emit — the commands it sends to other aggregates. */
  intentTypes: z.array(z.string()),
  hasWake: z.boolean(),
  /** The aggregate's current position, or null if the machine never started for it. */
  instance: aggregateProcessManagerInstanceSchema.nullable(),
  outbox: z.array(aggregateProcessManagerOutboxMessageSchema),
});
export type AggregateProcessManager = z.infer<typeof aggregateProcessManagerSchema>;
