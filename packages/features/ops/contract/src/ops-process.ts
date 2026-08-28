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
