import { z } from "zod";

/** A claimed slot must be untouched this long before an operator may clear it. */
export const SLOT_STALE_AFTER_MS = 15 * 60_000;

export interface OpsScheduledJob {
  id: string;
  projectId: string;
  targetType: string;
  targetId: string;
  cron: string;
  timezone: string;
  nextRunAt: string;
  lastSlot: string | null;
  active: boolean;
  projectName: string | null;
  createdAt: string;
  currentSlot: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

export type SchedulerControlAction =
  | "ops.scheduler.pause"
  | "ops.scheduler.resume"
  | "ops.scheduler.clear_slot"
  | "ops.scheduler.run_now";

export interface SchedulerAuditEntryView {
  id: string;
  at: string;
  action: string;
  scheduleId: string;
  projectId: string | null;
  actor: string | null;
}

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
export const opsScheduleIdInputSchema = z.object({ scheduleId: z.string() });

export const opsListScheduledJobsInputSchema = z.object({
  limit: z.number().int().min(1).max(500).default(200),
});

export const opsListPausedSchedulesInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
});

export const opsListSchedulerActionsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

export const opsSetScheduleActiveInputSchema = z.object({
  scheduleId: z.string(),
  active: z.boolean(),
});
