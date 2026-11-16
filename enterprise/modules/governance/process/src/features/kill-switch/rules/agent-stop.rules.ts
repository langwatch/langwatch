// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One stop's lifecycle as a pure fold over its events, shared by the AgentStop projection and the
 * stop's process manager so both read the same status. Spec: specs/agent-kill-switch.feature
 */
import {
  AGENT_STOP_OPEN_STATUSES,
  AGENT_STOP_RESTORABLE_STATUSES,
  type AgentStopApproval,
  type AgentStopDecidedEventData,
  type AgentStopPlanTarget,
  type AgentStopRequestedEventData,
  type AgentStopRestoreRequestedEventData,
  type AgentStopSeverity,
  type AgentStopStatus,
  type AgentStopTarget,
  type AgentStopTargetOutcome,
  type AgentStopTargetSettledEventData,
  type AgentStopTrigger,
  type AgentStopView,
  type AgentStopWebhookEventType,
  agentStopTargetOutcomeSchema,
  AGENT_STOP_APPROVALS,
  AGENT_STOP_SEVERITIES,
  AGENT_STOP_STATUSES,
  AGENT_STOP_TRIGGERS,
} from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

/** The stop as the fold keeps it: the view, plus what only the backend reads. */
export const agentStopRecordSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  status: z.enum(AGENT_STOP_STATUSES),
  severity: z.enum(AGENT_STOP_SEVERITIES),
  approval: z.enum(AGENT_STOP_APPROVALS),
  trigger: z.enum(AGENT_STOP_TRIGGERS),
  reason: z.string(),
  requestedByUserId: z.string().nullable(),
  requestedByApiKeyId: z.string().nullable(),
  decidedByUserId: z.string().nullable(),
  decidedByApiKeyId: z.string().nullable(),
  restoredByUserId: z.string().nullable(),
  targets: agentStopTargetOutcomeSchema.array(),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  quarantinedAt: z.string().nullable(),
  restoreRequestedAt: z.string().nullable(),
  restoredAt: z.string().nullable(),
  /** One more on every restore request, so a second restore's intents get keys of their own. */
  restoreRound: z.number().int().nonnegative(),
});
export type AgentStopRecord = z.infer<typeof agentStopRecordSchema>;

/** Millisecond ISO-8601, the precision Postgres keeps. */
export function stopTimestamp(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString({
    fractionalSecondDigits: 3,
  });
}

/** A person pressing Stop, or a critical stop from a machine credential, stops at once. */
export function approvalOf({
  trigger,
  severity,
}: {
  trigger: AgentStopTrigger;
  severity: AgentStopSeverity;
}): AgentStopApproval {
  if (trigger === "user") return "immediate";
  return severity === "critical" ? "immediate" : "required";
}

export function isOpenStatus(status: AgentStopStatus): boolean {
  return AGENT_STOP_OPEN_STATUSES.includes(status);
}

export function isRestorableStatus(status: AgentStopStatus): boolean {
  return AGENT_STOP_RESTORABLE_STATUSES.includes(status);
}

/** What a person reads for a target in lists, the audit row and the webhook body. */
export function labelOfTarget(target: AgentStopTarget): string {
  switch (target.kind) {
    case "databricks_serving_endpoint":
      return `Databricks serving endpoint ${target.endpointName}`;
    case "bedrock_agent_alias":
      return `Bedrock agent ${target.agentId} alias ${target.agentAliasId} (${target.region})`;
    case "gateway_virtual_key":
      return `Virtual key ${target.virtualKeyId}`;
  }
}

export function viewOfStop(record: AgentStopRecord): AgentStopView {
  return {
    id: record.id,
    agentId: record.agentId,
    agentName: record.agentName,
    status: record.status,
    severity: record.severity,
    approval: record.approval,
    trigger: record.trigger,
    reason: record.reason,
    requestedBy: { userId: record.requestedByUserId, apiKeyId: record.requestedByApiKeyId },
    decidedByUserId: record.decidedByUserId,
    restoredByUserId: record.restoredByUserId,
    targets: record.targets,
    requestedAt: record.requestedAt,
    decidedAt: record.decidedAt,
    quarantinedAt: record.quarantinedAt,
    restoreRequestedAt: record.restoreRequestedAt,
    restoredAt: record.restoredAt,
  };
}

function pendingOutcome(target: AgentStopPlanTarget): AgentStopTargetOutcome {
  return {
    id: target.id,
    label: target.label,
    target: target.target,
    state: "pending",
    errorCode: null,
    appliedAt: null,
    revertedAt: null,
  };
}

export function requestedStop({
  data,
  at,
}: {
  data: AgentStopRequestedEventData;
  at: number;
}): AgentStopRecord {
  return {
    id: data.stopId,
    organizationId: data.organizationId,
    agentId: data.agentId,
    agentName: data.agentName,
    status: data.approval === "immediate" ? "stopping" : "pending_approval",
    severity: data.severity,
    approval: data.approval,
    trigger: data.trigger,
    reason: data.reason,
    requestedByUserId: data.requestedByUserId,
    requestedByApiKeyId: data.requestedByApiKeyId,
    decidedByUserId: null,
    decidedByApiKeyId: null,
    restoredByUserId: null,
    targets: data.targets.map(pendingOutcome),
    requestedAt: stopTimestamp(at),
    decidedAt: null,
    quarantinedAt: null,
    restoreRequestedAt: null,
    restoredAt: null,
    restoreRound: 0,
  };
}

function decided({
  stop,
  data,
  at,
  status,
}: {
  stop: AgentStopRecord;
  data: AgentStopDecidedEventData;
  at: number;
  status: AgentStopStatus;
}): AgentStopRecord {
  if (stop.status !== "pending_approval") return stop;
  return {
    ...stop,
    status,
    decidedByUserId: data.decidedByUserId,
    decidedByApiKeyId: data.decidedByApiKeyId,
    decidedAt: stopTimestamp(at),
  };
}

export function approvedStop(input: {
  stop: AgentStopRecord;
  data: AgentStopDecidedEventData;
  at: number;
}): AgentStopRecord {
  return decided({ ...input, status: "stopping" });
}

export function deniedStop(input: {
  stop: AgentStopRecord;
  data: AgentStopDecidedEventData;
  at: number;
}): AgentStopRecord {
  return decided({ ...input, status: "denied" });
}

/** Once no target is pending, the stop is quarantined, or stop_failed when any target failed. */
function settleStop({ stop, at }: { stop: AgentStopRecord; at: number }): AgentStopRecord {
  if (stop.status !== "stopping") return stop;
  if (stop.targets.some((target) => target.state === "pending")) return stop;
  const allApplied = stop.targets.every((target) => target.state === "applied");
  return allApplied
    ? { ...stop, status: "quarantined", quarantinedAt: stopTimestamp(at) }
    : { ...stop, status: "stop_failed" };
}

/** Once no target is reverting, the stop is restored, or restore_failed when any revert failed. */
function settleRestore({ stop, at }: { stop: AgentStopRecord; at: number }): AgentStopRecord {
  if (stop.status !== "restoring") return stop;
  if (stop.targets.some((target) => target.state === "reverting")) return stop;
  const anyFailed = stop.targets.some((target) => target.state === "revert_failed");
  return anyFailed
    ? { ...stop, status: "restore_failed" }
    : { ...stop, status: "restored", restoredAt: stopTimestamp(at) };
}

function withTarget({
  stop,
  targetId,
  from,
  change,
}: {
  stop: AgentStopRecord;
  targetId: string;
  from: AgentStopTargetOutcome["state"];
  change: (target: AgentStopTargetOutcome) => AgentStopTargetOutcome;
}): AgentStopRecord {
  return {
    ...stop,
    targets: stop.targets.map((target) =>
      target.id === targetId && target.state === from ? change(target) : target,
    ),
  };
}

export function targetAppliedStop({
  stop,
  data,
  at,
}: {
  stop: AgentStopRecord;
  data: AgentStopTargetSettledEventData;
  at: number;
}): AgentStopRecord {
  if (stop.status !== "stopping") return stop;
  const changed = withTarget({
    stop,
    targetId: data.targetId,
    from: "pending",
    change: (target) => ({
      ...target,
      state: "applied",
      errorCode: null,
      appliedAt: stopTimestamp(at),
    }),
  });
  return settleStop({ stop: changed, at });
}

export function targetFailedStop({
  stop,
  data,
  at,
}: {
  stop: AgentStopRecord;
  data: AgentStopTargetSettledEventData;
  at: number;
}): AgentStopRecord {
  if (stop.status !== "stopping") return stop;
  const changed = withTarget({
    stop,
    targetId: data.targetId,
    from: "pending",
    change: (target) => ({ ...target, state: "failed", errorCode: data.errorCode }),
  });
  return settleStop({ stop: changed, at });
}

/**
 * A restore reverts what the stop applied, and retries what a previous restore failed to revert;
 * a target the stop never applied is left as it is.
 */
export function restoreRequestedStop({
  stop,
  data,
  at,
}: {
  stop: AgentStopRecord;
  data: AgentStopRestoreRequestedEventData;
  at: number;
}): AgentStopRecord {
  if (!isRestorableStatus(stop.status)) return stop;
  const restoring: AgentStopRecord = {
    ...stop,
    status: "restoring",
    restoredByUserId: data.requestedByUserId,
    restoreRequestedAt: stopTimestamp(at),
    restoreRound: data.restoreRound,
    targets: stop.targets.map((target) =>
      target.state === "applied" || target.state === "revert_failed"
        ? { ...target, state: "reverting", errorCode: null }
        : target,
    ),
  };
  return settleRestore({ stop: restoring, at });
}

/** A revert outcome from an earlier restore says nothing about the one in flight. */
function isStaleRound({
  stop,
  data,
}: {
  stop: AgentStopRecord;
  data: AgentStopTargetSettledEventData;
}): boolean {
  return data.restoreRound !== undefined && data.restoreRound !== stop.restoreRound;
}

export function targetRevertedStop({
  stop,
  data,
  at,
}: {
  stop: AgentStopRecord;
  data: AgentStopTargetSettledEventData;
  at: number;
}): AgentStopRecord {
  if (stop.status !== "restoring" || isStaleRound({ stop, data })) return stop;
  const changed = withTarget({
    stop,
    targetId: data.targetId,
    from: "reverting",
    change: (target) => ({
      ...target,
      state: "reverted",
      errorCode: null,
      revertedAt: stopTimestamp(at),
    }),
  });
  return settleRestore({ stop: changed, at });
}

export function targetRevertFailedStop({
  stop,
  data,
  at,
}: {
  stop: AgentStopRecord;
  data: AgentStopTargetSettledEventData;
  at: number;
}): AgentStopRecord {
  if (stop.status !== "restoring" || isStaleRound({ stop, data })) return stop;
  const changed = withTarget({
    stop,
    targetId: data.targetId,
    from: "reverting",
    change: (target) => ({ ...target, state: "revert_failed", errorCode: data.errorCode }),
  });
  return settleRestore({ stop: changed, at });
}

const MILESTONE_OF_STATUS: Partial<Record<AgentStopStatus, AgentStopWebhookEventType>> = {
  quarantined: "governance.agent.quarantined",
  stop_failed: "governance.agent.stop_failed",
  restored: "governance.agent.restored",
  restore_failed: "governance.agent.restore_failed",
};

/** The webhook and audit milestones a status change reaches: none or one. */
export function milestonesReached({
  before,
  after,
}: {
  before: AgentStopStatus | null;
  after: AgentStopStatus;
}): AgentStopWebhookEventType[] {
  if (before === after) return [];
  if (before === null)
    return after === "pending_approval" ? ["governance.agent.stop_requested"] : [];
  const milestone = MILESTONE_OF_STATUS[after];
  return milestone ? [milestone] : [];
}

/** The Agents-page rows a registry entry backs, read off its source key: none or one. */
export function inventoryRowIdsOf(sourceKey: string): string[] {
  if (sourceKey.startsWith("langwatch:"))
    return [`registered:${sourceKey.slice("langwatch:".length)}`];
  if (sourceKey.startsWith("discovered:")) return [sourceKey];
  return [];
}
