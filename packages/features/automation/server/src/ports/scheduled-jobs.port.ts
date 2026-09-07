import type { Instant } from "@langwatch/time";

export type ScheduledJobRecord = {
  targetId: string;
  nextRunAt: Instant;
  lastSlot: Instant | null;
  active: boolean;
};

export abstract class ScheduledJobStorePort {
  abstract upsertForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
    cron: string;
    timezone: string;
    nextRunAt: Instant;
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
