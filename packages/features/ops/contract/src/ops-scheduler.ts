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
