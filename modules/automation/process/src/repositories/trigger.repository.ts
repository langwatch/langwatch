import type {
  CreateTriggerCommand,
  Trigger,
  TriggerSummary,
  UpdateTriggerCommand,
  AutomationUsageCount,
} from "@langwatch/automation-contract";
export type ReportScheduleTarget = {
  id: string;
  projectId: string;
  actionParams: Record<string, unknown>;
};
export abstract class TriggerRepository {
  abstract findActiveForProject(projectId: string): Promise<TriggerSummary[]>;
  /** The usage report's count, deleted included; the caller never passes an empty project list. */
  abstract countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<AutomationUsageCount>;
  abstract findActiveReportTargets(): Promise<ReportScheduleTarget[]>;
  /** Every report that is not deleted, paused ones included, across projects. */
  abstract findAllReportTargets(): Promise<ReportScheduleTarget[]>;
  abstract claimSend(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;
  abstract isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;
  abstract findClaimedTraceIds(input: {
    triggerId: string;
    traceIds: string[];
    projectId: string;
  }): Promise<Set<string>>;
  abstract updateLastRunAt(input: { triggerId: string; projectId: string }): Promise<void>;
  abstract findByIdOrThrow(input: { triggerId: string; projectId: string }): Promise<Trigger>;
  abstract findById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
  abstract findAllByProjectId(input: { projectId: string }): Promise<Trigger[]>;
  abstract findByCustomGraphId(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null>;
  abstract findByCustomGraphIds(input: {
    projectId: string;
    customGraphIds: string[];
  }): Promise<Trigger[]>;
  abstract create(input: CreateTriggerCommand): Promise<Trigger>;
  abstract update(input: UpdateTriggerCommand): Promise<Trigger>;
}
