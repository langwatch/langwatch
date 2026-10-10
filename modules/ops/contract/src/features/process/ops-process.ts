import type { Named } from "@langwatch/module";
import { z } from "zod";

/** One process manager's registry identity joined to its live trouble counts. */
const processFleetSummarySchemaDefinition = z.object({
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
export interface ProcessFleetSummarySchema extends Named<
  typeof processFleetSummarySchemaDefinition
> {}
export const processFleetSummarySchema: ProcessFleetSummarySchema =
  processFleetSummarySchemaDefinition;
export type ProcessFleetSummary = z.infer<typeof processFleetSummarySchema>;

/** One process ref, the triple every process-manager read is keyed by. */
const opsProcessRefInputSchemaDefinition = z.object({
  processName: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  processKey: z.string().min(1).max(500),
});
export interface OpsProcessRefInputSchema extends Named<
  typeof opsProcessRefInputSchemaDefinition
> {}
export const opsProcessRefInputSchema: OpsProcessRefInputSchema =
  opsProcessRefInputSchemaDefinition;

/** One message inside one process instance's outbox. */
const opsProcessMessageInputSchemaDefinition = z.object({
  ...opsProcessRefInputSchema.shape,
  messageId: z.string().min(1).max(64),
});
export interface OpsProcessMessageInputSchema extends Named<
  typeof opsProcessMessageInputSchemaDefinition
> {}
export const opsProcessMessageInputSchema: OpsProcessMessageInputSchema =
  opsProcessMessageInputSchemaDefinition;

const opsAggregateProcessManagersInputSchemaDefinition = z.object({
  aggregateType: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  aggregateId: z.string().min(1).max(500),
});
export interface OpsAggregateProcessManagersInputSchema extends Named<
  typeof opsAggregateProcessManagersInputSchemaDefinition
> {}
export const opsAggregateProcessManagersInputSchema: OpsAggregateProcessManagersInputSchema =
  opsAggregateProcessManagersInputSchemaDefinition;

const opsRequeueDeadOutboxMessagesInputSchemaDefinition = z.object({
  processName: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  processKey: z.string().min(1).max(500),
  messageKeyPrefix: z.string().min(1).max(500).optional(),
});
export interface OpsRequeueDeadOutboxMessagesInputSchema extends Named<
  typeof opsRequeueDeadOutboxMessagesInputSchemaDefinition
> {}
export const opsRequeueDeadOutboxMessagesInputSchema: OpsRequeueDeadOutboxMessagesInputSchema =
  opsRequeueDeadOutboxMessagesInputSchemaDefinition;

const opsListDeadLettersInputSchemaDefinition = z.object({
  /** Omit for every process. */
  processName: z.string().min(1).max(200).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export interface OpsListDeadLettersInputSchema extends Named<
  typeof opsListDeadLettersInputSchemaDefinition
> {}
export const opsListDeadLettersInputSchema: OpsListDeadLettersInputSchema =
  opsListDeadLettersInputSchemaDefinition;

const opsListProcessInstancesInputSchemaDefinition = z.object({
  /** Omit to list instances across every process manager. */
  processName: z.string().min(1).max(200).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().max(500).optional(),
});
export interface OpsListProcessInstancesInputSchema extends Named<
  typeof opsListProcessInstancesInputSchemaDefinition
> {}
export const opsListProcessInstancesInputSchema: OpsListProcessInstancesInputSchema =
  opsListProcessInstancesInputSchemaDefinition;

const opsListUpcomingWakesInputSchemaDefinition = z.object({
  limit: z.number().int().min(1).max(200).default(20),
});
export interface OpsListUpcomingWakesInputSchema extends Named<
  typeof opsListUpcomingWakesInputSchemaDefinition
> {}
export const opsListUpcomingWakesInputSchema: OpsListUpcomingWakesInputSchema =
  opsListUpcomingWakesInputSchemaDefinition;

const opsListProcessOutboxInputSchemaDefinition = z.object({
  ...opsProcessRefInputSchema.shape,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export interface OpsListProcessOutboxInputSchema extends Named<
  typeof opsListProcessOutboxInputSchemaDefinition
> {}
export const opsListProcessOutboxInputSchema: OpsListProcessOutboxInputSchema =
  opsListProcessOutboxInputSchemaDefinition;

const opsListProcessActionsInputSchemaDefinition = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});
export interface OpsListProcessActionsInputSchema extends Named<
  typeof opsListProcessActionsInputSchemaDefinition
> {}
export const opsListProcessActionsInputSchema: OpsListProcessActionsInputSchema =
  opsListProcessActionsInputSchemaDefinition;

const opsRedriveDeadLettersInputSchemaDefinition = z.object({
  processName: z.string().min(1).max(200).optional(),
});
export interface OpsRedriveDeadLettersInputSchema extends Named<
  typeof opsRedriveDeadLettersInputSchemaDefinition
> {}
export const opsRedriveDeadLettersInputSchema: OpsRedriveDeadLettersInputSchema =
  opsRedriveDeadLettersInputSchemaDefinition;

/**
 * The fleet-wide discard - no `processName` - crosses every tenant and
 * cannot be undone. It takes a typed confirmation, so the destructive
 * breadth is reached deliberately, not by omitting a field.
 */
const opsDiscardDeadLettersInputSchemaDefinition = z
  .object({
    processName: z.string().min(1).max(200).optional(),
    confirm: z.literal("DISCARD ALL").optional(),
  })
  .refine((input) => !!input.processName || input.confirm !== undefined, {
    message: "Discarding every process's dead letters requires an explicit confirmation",
    path: ["confirm"],
  });
export interface OpsDiscardDeadLettersInputSchema extends Named<
  typeof opsDiscardDeadLettersInputSchemaDefinition
> {}
export const opsDiscardDeadLettersInputSchema: OpsDiscardDeadLettersInputSchema =
  opsDiscardDeadLettersInputSchemaDefinition;

const opsListOutboxAttemptsInputSchemaDefinition = z.object({
  outboxId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(200),
});
export interface OpsListOutboxAttemptsInputSchema extends Named<
  typeof opsListOutboxAttemptsInputSchemaDefinition
> {}
export const opsListOutboxAttemptsInputSchema: OpsListOutboxAttemptsInputSchema =
  opsListOutboxAttemptsInputSchemaDefinition;

// Process-manager explorer vocabulary: OpsProcessExplorer returns unknown because
// it lived in platform/app; these shapes let the client publish the concrete types.

/** One instance of a process manager, as the fleet table lists it. */
const processInstanceRowSchemaDefinition = z.object({
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
export interface ProcessInstanceRowSchema extends Named<
  typeof processInstanceRowSchemaDefinition
> {}
export const processInstanceRowSchema: ProcessInstanceRowSchema =
  processInstanceRowSchemaDefinition;
export type ProcessInstanceRow = z.infer<typeof processInstanceRowSchema>;

/** One upcoming instance wake, for the dashboard's timed-work table. */
const processWakeRowSchemaDefinition = z.object({
  processName: z.string(),
  projectId: z.string(),
  processKey: z.string(),
  nextWakeAt: z.number(),
});
export interface ProcessWakeRowSchema extends Named<typeof processWakeRowSchemaDefinition> {}
export const processWakeRowSchema: ProcessWakeRowSchema = processWakeRowSchemaDefinition;
export type ProcessWakeRow = z.infer<typeof processWakeRowSchema>;

/** What an outbox message can be, in the order a delivery moves through. */
export const processOutboxStatusSchema = z.enum(["pending", "dispatched", "dead", "discarded"]);

/** One message in an instance's transactional outbox. */
const processOutboxMessageViewSchemaDefinition = z.object({
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
export interface ProcessOutboxMessageViewSchema extends Named<
  typeof processOutboxMessageViewSchemaDefinition
> {}
export const processOutboxMessageViewSchema: ProcessOutboxMessageViewSchema =
  processOutboxMessageViewSchemaDefinition;
export type ProcessOutboxMessageView = z.infer<typeof processOutboxMessageViewSchema>;

/**
 * A retired message, with the identity needed to act on it: the full ref so
 * a row can be redriven straight from the list, and the trace id so the
 * operator can reach the failure itself.
 */
const deadOutboxMessageViewSchemaDefinition = z.object({
  ...processOutboxMessageViewSchema.shape,
  processName: z.string(),
  projectId: z.string(),
  processKey: z.string(),
  /** Last write to the row, which for a dead row is when it was retired. */
  updatedAt: z.number(),
});
export interface DeadOutboxMessageViewSchema extends Named<
  typeof deadOutboxMessageViewSchemaDefinition
> {}
export const deadOutboxMessageViewSchema: DeadOutboxMessageViewSchema =
  deadOutboxMessageViewSchemaDefinition;
export type DeadOutboxMessageView = z.infer<typeof deadOutboxMessageViewSchema>;

/** One process's share of the dead total, for the fleet-level summary. */
const deadLetterCountSchemaDefinition = z.object({
  processName: z.string(),
  count: z.number(),
  /** Oldest retirement in this group, so the operator can age the incident. */
  oldestUpdatedAt: z.number(),
});
export interface DeadLetterCountSchema extends Named<typeof deadLetterCountSchemaDefinition> {}
export const deadLetterCountSchema: DeadLetterCountSchema = deadLetterCountSchemaDefinition;
export type DeadLetterCount = z.infer<typeof deadLetterCountSchema>;

/**
 * One FAILED delivery attempt of an outbox message, oldest first — why a dead
 * letter died, on the page (specs/ops/dead-letter-recovery.feature).
 */
const outboxAttemptViewSchemaDefinition = z.object({
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
export interface OutboxAttemptViewSchema extends Named<typeof outboxAttemptViewSchemaDefinition> {}
export const outboxAttemptViewSchema: OutboxAttemptViewSchema = outboxAttemptViewSchemaDefinition;
export type OutboxAttemptView = z.infer<typeof outboxAttemptViewSchema>;

/** One process-control act, as the audit trail keeps it. */
const processAuditEntryViewSchemaDefinition = z.object({
  id: z.string(),
  createdAt: z.number(),
  action: z.string(),
  targetId: z.string(),
  actorUserId: z.string().nullable(),
  metadata: z.unknown(),
});
export interface ProcessAuditEntryViewSchema extends Named<
  typeof processAuditEntryViewSchemaDefinition
> {}
export const processAuditEntryViewSchema: ProcessAuditEntryViewSchema =
  processAuditEntryViewSchemaDefinition;
export type ProcessAuditEntryView = z.infer<typeof processAuditEntryViewSchema>;

/** Which instance of which process manager, in one value. */
const opsProcessRefViewSchemaDefinition = z.object({
  processName: z.string(),
  projectId: z.string(),
  processKey: z.string(),
});
export interface OpsProcessRefViewSchema extends Named<typeof opsProcessRefViewSchemaDefinition> {}
export const opsProcessRefViewSchema: OpsProcessRefViewSchema = opsProcessRefViewSchemaDefinition;
export type OpsProcessRefView = z.infer<typeof opsProcessRefViewSchema>;

/** One instance in full, as the detail panel reads it. */
const processInstanceDetailSchemaDefinition = z.object({
  ref: opsProcessRefViewSchema,
  tenantId: z.string(),
  state: z.unknown(),
  revision: z.number(),
  nextWakeAt: z.number().nullable(),
  updatedAt: z.number(),
});
export interface ProcessInstanceDetailSchema extends Named<
  typeof processInstanceDetailSchemaDefinition
> {}
export const processInstanceDetailSchema: ProcessInstanceDetailSchema =
  processInstanceDetailSchemaDefinition;
export type ProcessInstanceDetail = z.infer<typeof processInstanceDetailSchema>;

/** The aggregate's current position in one manager's machine. */
const aggregateProcessManagerInstanceSchemaDefinition = z.object({
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
export interface AggregateProcessManagerInstanceSchema extends Named<
  typeof aggregateProcessManagerInstanceSchemaDefinition
> {}
export const aggregateProcessManagerInstanceSchema: AggregateProcessManagerInstanceSchema =
  aggregateProcessManagerInstanceSchemaDefinition;
export type AggregateProcessManagerInstance = z.infer<typeof aggregateProcessManagerInstanceSchema>;

/** One cross-aggregate command this instance emitted, via the outbox. */
const aggregateProcessManagerOutboxMessageSchemaDefinition = z.object({
  messageKey: z.string(),
  intentType: z.string(),
  status: processOutboxStatusSchema,
  attempts: z.number(),
  nextAttemptAt: z.number(),
  createdAt: z.number(),
  /** The event that produced this intent; null for a wake-driven commit. */
  sourceEventId: z.string().nullable(),
});
export interface AggregateProcessManagerOutboxMessageSchema extends Named<
  typeof aggregateProcessManagerOutboxMessageSchemaDefinition
> {}
export const aggregateProcessManagerOutboxMessageSchema: AggregateProcessManagerOutboxMessageSchema =
  aggregateProcessManagerOutboxMessageSchemaDefinition;
export type AggregateProcessManagerOutboxMessage = z.infer<
  typeof aggregateProcessManagerOutboxMessageSchema
>;

/** One process-manager state machine as it stands for a single aggregate. */
const aggregateProcessManagerSchemaDefinition = z.object({
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
export interface AggregateProcessManagerSchema extends Named<
  typeof aggregateProcessManagerSchemaDefinition
> {}
export const aggregateProcessManagerSchema: AggregateProcessManagerSchema =
  aggregateProcessManagerSchemaDefinition;
export type AggregateProcessManager = z.infer<typeof aggregateProcessManagerSchema>;
