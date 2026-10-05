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
/** The deployment's cipher; the live repository seals and opens `actionParams` secrets with it. */
export abstract class TriggerSecretCipher {
  abstract encrypt(value: string): string;
  abstract decrypt(value: string): string;
}

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
  /** Every undeleted Slack automation of these projects, oldest first. */
  abstract findSlackTriggers(input: { projectIds: readonly string[] }): Promise<Trigger[]>;
  /** Replaces `actionParams` only while they still equal `expected`; false when the row changed. */
  abstract replaceActionParamsIfUnchanged(input: {
    triggerId: string;
    projectId: string;
    expected: unknown;
    actionParams: Record<string, unknown>;
  }): Promise<boolean>;
  abstract create(input: CreateTriggerCommand): Promise<Trigger>;
  abstract update(input: UpdateTriggerCommand): Promise<Trigger>;
  /** A secret stored in `actionParams` in the clear; called only where it is sent or re-written. */
  abstract openSecret(input: { sealed: string }): string;
  /** A secret in its stored form, as earlier releases wrote it; called only where one is saved. */
  abstract sealSecret(input: { plain: string }): string;
}

/** The two secret operations, for a service that sends or writes a stored secret. */
export type TriggerSecretSeal = Pick<TriggerRepository, "openSecret" | "sealSecret">;
