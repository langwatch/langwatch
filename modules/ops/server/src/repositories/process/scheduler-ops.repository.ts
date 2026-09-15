/** Scheduler persistence operations exposed to the Ops control surface. */
export abstract class SchedulerOpsRepository {
  abstract tryFindByIdForOps(params: { id: string }): Promise<ScheduledJobRecord | null>;
  abstract setActiveForOps(params: {
    id: string;
    projectId: string;
    active: boolean;
  }): Promise<boolean>;
  abstract releaseSlotForOps(params: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    now: Date;
  }): Promise<boolean>;
  abstract requestImmediateRunForOps(params: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    now: Date;
  }): Promise<boolean>;
  abstract listForOps(params: { limit: number }): Promise<ScheduledJobRecord[]>;
  abstract listPausedForOps(params: {
    limit: number;
  }): Promise<{ rows: ScheduledJobRecord[]; total: number }>;
}

export interface ScheduledJobRecord {
  id: string;
  projectId: string;
  targetType: string;
  targetId: string;
  cron: string;
  timezone: string;
  nextRunAt: Date;
  lastSlot: Date | null;
  currentSlot: Date | null;
  attempts: number;
  lastError: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
