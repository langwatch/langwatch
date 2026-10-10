import type { Named } from "@langwatch/module";
import { z } from "zod";

/** A held run must be untouched this long before an operator may clear it. */
export const SLOT_STALE_AFTER_MS = 15 * 60_000;

const opsScheduledJobSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  cron: z.string(),
  timezone: z.string(),
  /** Null while paused: a paused report schedule arms no next run. */
  nextRunAt: z.string().nullable(),
  lastSlot: z.string().nullable(),
  active: z.boolean(),
  projectName: z.string().nullable(),
  createdAt: z.string(),
  currentSlot: z.string().nullable(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  updatedAt: z.string(),
});
export interface OpsScheduledJobSchema extends Named<typeof opsScheduledJobSchemaDefinition> {}
export const opsScheduledJobSchema: OpsScheduledJobSchema = opsScheduledJobSchemaDefinition;
export type OpsScheduledJob = z.infer<typeof opsScheduledJobSchema>;

export type SchedulerControlAction =
  | "ops.scheduler.pause"
  | "ops.scheduler.resume"
  | "ops.scheduler.clear_slot"
  | "ops.scheduler.run_now";

const schedulerAuditEntryViewSchemaDefinition = z.object({
  id: z.string(),
  at: z.string(),
  action: z.string(),
  scheduleId: z.string(),
  projectId: z.string().nullable(),
  actor: z.string().nullable(),
});
export interface SchedulerAuditEntryViewSchema extends Named<
  typeof schedulerAuditEntryViewSchemaDefinition
> {}
export const schedulerAuditEntryViewSchema: SchedulerAuditEntryViewSchema =
  schedulerAuditEntryViewSchemaDefinition;
export type SchedulerAuditEntryView = z.infer<typeof schedulerAuditEntryViewSchema>;

export interface ListScheduledJobsInput {
  limit?: number;
}

export interface ListPausedSchedulesInput {
  limit?: number;
}

export interface ListSchedulerActionsInput {
  limit?: number;
}

export interface SetScheduleActiveInput {
  scheduleId: string;
  active: boolean;
  actorUserId: string;
}

export interface ScheduleControlInput {
  scheduleId: string;
  actorUserId: string;
}

/**
 * The input shapes the operator scheduler surface parses. The listing limits
 * are defaulted and bounded here because the transport is what a caller can
 * push on; the service inputs above leave `limit` optional.
 */
const opsScheduleIdInputSchemaDefinition = z.object({ scheduleId: z.string() });
export interface OpsScheduleIdInputSchema extends Named<
  typeof opsScheduleIdInputSchemaDefinition
> {}
export const opsScheduleIdInputSchema: OpsScheduleIdInputSchema =
  opsScheduleIdInputSchemaDefinition;

const opsListScheduledJobsInputSchemaDefinition = z.object({
  limit: z.number().int().min(1).max(500).default(200),
});
export interface OpsListScheduledJobsInputSchema extends Named<
  typeof opsListScheduledJobsInputSchemaDefinition
> {}
export const opsListScheduledJobsInputSchema: OpsListScheduledJobsInputSchema =
  opsListScheduledJobsInputSchemaDefinition;

const opsListPausedSchedulesInputSchemaDefinition = z.object({
  limit: z.number().int().min(1).max(200).default(50),
});
export interface OpsListPausedSchedulesInputSchema extends Named<
  typeof opsListPausedSchedulesInputSchemaDefinition
> {}
export const opsListPausedSchedulesInputSchema: OpsListPausedSchedulesInputSchema =
  opsListPausedSchedulesInputSchemaDefinition;

const opsListSchedulerActionsInputSchemaDefinition = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});
export interface OpsListSchedulerActionsInputSchema extends Named<
  typeof opsListSchedulerActionsInputSchemaDefinition
> {}
export const opsListSchedulerActionsInputSchema: OpsListSchedulerActionsInputSchema =
  opsListSchedulerActionsInputSchemaDefinition;

const opsSetScheduleActiveInputSchemaDefinition = z.object({
  scheduleId: z.string(),
  active: z.boolean(),
});
export interface OpsSetScheduleActiveInputSchema extends Named<
  typeof opsSetScheduleActiveInputSchemaDefinition
> {}
export const opsSetScheduleActiveInputSchema: OpsSetScheduleActiveInputSchema =
  opsSetScheduleActiveInputSchemaDefinition;
