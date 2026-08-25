export type ScheduledJobRecord = {
  targetId: string;
  nextRunAt: Date;
  lastSlot: Date | null;
  active: boolean;
};

export abstract class ScheduledJobStore {
  abstract upsertForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
    cron: string;
    timezone: string;
    nextRunAt: Date;
  }): Promise<void>;
  abstract deactivateForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
  }): Promise<void>;
  abstract findAllForProject(input: {
    projectId: string;
    targetType: string;
  }): Promise<ScheduledJobRecord[]>;
}

export abstract class ScheduledJobStorePort extends ScheduledJobStore {}
