import type {
  CreateTriggerCommand,
  Trigger,
  TriggerSummary,
  UpdateTriggerCommand,
} from "@langwatch/automation-contract";
export type ReportScheduleTarget = {
  id: string;
  projectId: string;
  actionParams: Record<string, unknown>;
};
export abstract class TriggerRepository {
  abstract findActiveForProject(projectId: string): Promise<TriggerSummary[]>;
  abstract findActiveReportTargets(): Promise<ReportScheduleTarget[]>;
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
  abstract updateLastRunAt(input: {
    triggerId: string;
    projectId: string;
  }): Promise<void>;
  abstract findByIdOrThrow(input: {
    triggerId: string;
    projectId: string;
  }): Promise<Trigger>;
  abstract tryFindById(input: {
    triggerId: string;
    projectId: string;
  }): Promise<Trigger | null>;
  abstract findAllByProjectId(input: { projectId: string }): Promise<Trigger[]>;
  abstract tryFindByCustomGraphId(input: {
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
