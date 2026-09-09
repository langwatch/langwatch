/**
 * The `ops.*` procedures the process-manager fleet pages call: what each
 * manager is doing, what has stopped, and the verbs that put it back in
 * motion. One of five declarations under `ops` - see `ops-dashboard.trpc.ts`.
 * Spec: specs/ops/process-manager-visibility.feature.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  aggregateProcessManagerSchema,
  deadLetterCountSchema,
  opsAggregateProcessManagersInputSchema,
  opsDiscardDeadLettersInputSchema,
  opsListDeadLettersInputSchema,
  opsListOutboxAttemptsInputSchema,
  opsListProcessActionsInputSchema,
  opsListProcessInstancesInputSchema,
  opsListProcessOutboxInputSchema,
  opsListUpcomingWakesInputSchema,
  opsProcessMessageInputSchema,
  opsProcessRefInputSchema,
  opsRedriveDeadLettersInputSchema,
  opsRequeueDeadOutboxMessagesInputSchema,
  outboxAttemptViewSchema,
  processAuditEntryViewSchema,
  processFleetSummarySchema,
  processInstanceDetailSchema,
  processWakeRowSchema,
} from "./ops-process.ts";
import {
  opsDeadLetterPageSchema,
  opsProcessDiscardedDeadLettersSchema,
  opsProcessDiscardedMessageSchema,
  opsProcessInstancePageSchema,
  opsProcessOutboxPageSchema,
  opsProcessRedrivenDeadLettersSchema,
  opsProcessRedrivenMessageSchema,
  opsProcessReleasedLeaseSchema,
  opsProcessRequeuedSchema,
  opsProcessWokeSchema,
} from "./ops.responses.ts";

export const opsProcessTrpc = defineTrpcContract("ops")
  /**
   * The per-aggregate process-manager state machines for one aggregate: each
   * machine's definition joined to this aggregate's current instance state and
   * the intents it has emitted. Scheduled singletons are excluded, because
   * they are not keyed by aggregate id.
   */
  .query("getAggregateProcessManagers")
  .withInput(opsAggregateProcessManagersInputSchema)
  .withOutput(aggregateProcessManagerSchema.array())

  /**
   * Dead-letter recovery: requeue one process instance's DEAD outbox rows
   * (optionally narrowed by message-key prefix) as pending, due now, with a
   * fresh attempt budget.
   */
  .mutation("requeueDeadOutboxMessages")
  .withInput(opsRequeueDeadOutboxMessagesInputSchema)
  .withOutput(opsProcessRequeuedSchema)

  /** One row per process name: registry identity and live trouble counts. */
  .query("listProcessFleet")
  .withInput(z.void())
  .withOutput(processFleetSummarySchema.array())

  /**
   * Retired messages across every process. Answers "what has permanently
   * stopped", which `listProcessOutbox` could not: that one needs a full
   * process ref, so it can only be reached by an operator who already knows
   * where the failure is.
   */
  .query("listDeadLetters")
  .withInput(opsListDeadLettersInputSchema)
  .withOutput(opsDeadLetterPageSchema)

  /** Dead totals per process, for the navigation badge and dashboard card. */
  .query("listDeadLetterCounts")
  .withInput(z.void())
  .withOutput(deadLetterCountSchema.array())

  .query("listProcessInstances")
  .withInput(opsListProcessInstancesInputSchema)
  .withOutput(opsProcessInstancePageSchema)

  /** The soonest-due process wakes, for the dashboard's timed-work table. */
  .query("listUpcomingWakes")
  .withInput(opsListUpcomingWakesInputSchema)
  .withOutput(processWakeRowSchema.array())

  .query("getProcessInstance")
  .withInput(opsProcessRefInputSchema)
  .withOutput(processInstanceDetailSchema.nullable())

  .query("listProcessOutbox")
  .withInput(opsListProcessOutboxInputSchema)
  .withOutput(opsProcessOutboxPageSchema)

  .query("listProcessActions")
  .withInput(opsListProcessActionsInputSchema)
  .withOutput(processAuditEntryViewSchema.array())

  .mutation("processWakeNow")
  .withInput(opsProcessRefInputSchema)
  .withOutput(opsProcessWokeSchema)

  .mutation("processRedriveDeadInstance")
  .withInput(opsProcessRefInputSchema)
  .withOutput(opsProcessRequeuedSchema)

  .mutation("processRedriveDeadMessage")
  .withInput(opsProcessMessageInputSchema)
  .withOutput(opsProcessRedrivenMessageSchema)

  /** Mark one dead message never-to-be-sent - a mark, not a delete. */
  .mutation("processDiscardDeadMessage")
  .withInput(opsProcessMessageInputSchema)
  .withOutput(opsProcessDiscardedMessageSchema)

  /**
   * Every dead letter back to pending - one process, or the fleet when
   * `processName` is omitted (specs/ops/dead-letter-recovery.feature).
   */
  .mutation("redriveDeadLetters")
  .withInput(opsRedriveDeadLettersInputSchema)
  .withOutput(opsProcessRedrivenDeadLettersSchema)

  /**
   * Every dead letter marked discarded; same scoping as the redrive. The
   * fleet-wide form crosses every tenant and cannot be undone, since no
   * redrive path selects a discarded row, so it takes a typed confirmation.
   */
  .mutation("discardDeadLetters")
  .withInput(opsDiscardDeadLettersInputSchema)
  .withOutput(opsProcessDiscardedDeadLettersSchema)

  /** The message's failed attempts, oldest first - why a dead letter died. */
  .query("listOutboxAttempts")
  .withInput(opsListOutboxAttemptsInputSchema)
  .withOutput(outboxAttemptViewSchema.array())

  .mutation("processReleaseLapsedLease")
  .withInput(opsProcessMessageInputSchema)
  .withOutput(opsProcessReleasedLeaseSchema)
  .build();
