// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One stop's lifecycle as a pure fold over its events, shared by the AgentStop projection and the
 * stop's process manager so both read the same status. Spec: specs/agent-kill-switch.feature
 */
import {
  AGENT_STOP_OPEN_STATUSES,
  AGENT_STOP_RESTORABLE_STATUSES,
  AGENT_STOP_RETRYABLE_STATUSES,
  type AgentStopApproval,
  type AgentStopDecidedEventData,
  type AgentStopPlanTarget,
  type AgentStopRequestedEventData,
  type AgentStopRestoreRequestedEventData,
  type AgentStopRetryRequestedEventData,
  type AgentStopSeverity,
  type AgentStopStatus,
  type AgentStopTarget,
  type AgentStopTargetOutcome,
  type AgentStopTargetSettledEventData,
  type AgentStopTargetsDroppedEventData,
  type AgentStopTrigger,
  type AgentStopView,
  type AgentStopWebhookEventType,
  agentStopTargetOutcomeSchema,
  AGENT_STOP_APPROVALS,
  AGENT_STOP_SEVERITIES,
  AGENT_STOP_STATUSES,
  AGENT_STOP_TRIGGERS,
  GovernanceValidationError,
} from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

/** The AgentStop projection's version, also stamped on a requested stop's seed row. */
export const AGENT_STOP_PROJECTION_VERSION = "2026-11-16" as const;

/** Where a stop sits in the latest-first listing. */
type StopPosition = { requestedAt: string; id: string };

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
  restoredByApiKeyId: z.string().nullable().default(null),
  targets: agentStopTargetOutcomeSchema.array(),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  quarantinedAt: z.string().nullable(),
  restoreRequestedAt: z.string().nullable(),
  restoredAt: z.string().nullable(),
  /** One more on every restore the fold accepts, so each accepted restore's intents get keys of their own. */
  restoreRound: z.number().int().nonnegative(),
  /** One more on every retry the fold accepts, so each retry's applies and milestones get keys of their own. */
  retryRound: z.number().int().nonnegative().default(0),
  retriedByUserId: z.string().nullable().default(null),
  retriedByApiKeyId: z.string().nullable().default(null),
  /** The last restore or retry request the fold accepted. */
  lastRequestId: z.string().nullable().default(null),
  /** Requests the API folded onto the row before the worker did; each one's event folds as a no-op. */
  advancedRequestIds: z.string().array().default([]),
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

/** True when the plan holds exactly the target ids the caller confirmed. */
export function isSamePlan(targetIds: readonly string[], expected: readonly string[]): boolean {
  const held = new Set(targetIds);
  return held.size === new Set(expected).size && expected.every((id) => held.has(id));
}

/** The requesting key, or the person behind it (the key's owner, or another key they own). */
export function isRequester({
  caller,
  stop,
}: {
  caller: { userId: string | null; apiKeyId: string | null };
  stop: AgentStopRecord;
}): boolean {
  if (caller.apiKeyId && caller.apiKeyId === stop.requestedByApiKeyId) return true;
  return caller.userId !== null && caller.userId === stop.requestedByUserId;
}

export function isOpenStatus(status: AgentStopStatus): boolean {
  return AGENT_STOP_OPEN_STATUSES.includes(status);
}

export function isRestorableStatus(status: AgentStopStatus): boolean {
  return AGENT_STOP_RESTORABLE_STATUSES.includes(status);
}

export function isRetryableStatus(status: AgentStopStatus): boolean {
  return AGENT_STOP_RETRYABLE_STATUSES.includes(status);
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
    ...(record.lastRequestId ? { lastRequestId: record.lastRequestId } : {}),
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
    restoredByApiKeyId: null,
    targets: data.targets.map(pendingOutcome),
    requestedAt: stopTimestamp(at),
    decidedAt: null,
    quarantinedAt: null,
    restoreRequestedAt: null,
    restoredAt: null,
    restoreRound: 0,
    retryRound: 0,
    retriedByUserId: null,
    retriedByApiKeyId: null,
    lastRequestId: null,
    advancedRequestIds: [],
  };
}

/** The stop as the API advances its row ahead of the worker: it remembers the request it folded. */
export function advancedStop({
  stop,
  requestId,
}: {
  stop: AgentStopRecord;
  requestId: string;
}): AgentStopRecord {
  return { ...stop, advancedRequestIds: [...stop.advancedRequestIds, requestId] };
}

/** Folds a request by `fold`, unless the API already advanced the stop by it: then it lets go of it. */
export function foldRequestOnce({
  stop,
  requestId,
  fold,
}: {
  stop: AgentStopRecord;
  requestId: string;
  fold: (stop: AgentStopRecord) => AgentStopRecord;
}): AgentStopRecord {
  if (!stop.advancedRequestIds.includes(requestId)) return fold(stop);
  const advancedRequestIds = stop.advancedRequestIds.filter((held) => held !== requestId);
  return { ...stop, advancedRequestIds };
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

/** An approved stop whose plan lost every target meanwhile has nothing to apply: it closes. */
export function approvedStop(input: {
  stop: AgentStopRecord;
  data: AgentStopDecidedEventData;
  at: number;
}): AgentStopRecord {
  return settleStop({ stop: decided({ ...input, status: "stopping" }), at: input.at });
}

export function deniedStop(input: {
  stop: AgentStopRecord;
  data: AgentStopDecidedEventData;
  at: number;
}): AgentStopRecord {
  return decided({ ...input, status: "denied" });
}

/** A target taken out of the plan only waits for its revert; it no longer decides the status. */
function isLive(target: AgentStopTargetOutcome): boolean {
  return target.dropped !== true;
}

function isInFlight(target: AgentStopTargetOutcome): boolean {
  return target.state === "pending" || target.state === "reverting";
}

/**
 * Once no target the plan still holds is pending, the stop is quarantined, or stop_failed when any
 * failed. A stop left with none holds nothing: it closes once what it changed is reverted.
 */
function settleStop({ stop, at }: { stop: AgentStopRecord; at: number }): AgentStopRecord {
  if (stop.status !== "stopping") return stop;
  const live = stop.targets.filter(isLive);
  if (live.length === 0) return settleEmpty({ stop, at });
  if (live.some((target) => target.state === "pending")) return stop;
  const allApplied = live.every((target) => target.state === "applied");
  return allApplied
    ? { ...stop, status: "quarantined", quarantinedAt: stopTimestamp(at) }
    : { ...stop, status: "stop_failed" };
}

/** A stop with no target left in its plan: restored, or restore_failed while a revert failed. */
function settleEmpty({ stop, at }: { stop: AgentStopRecord; at: number }): AgentStopRecord {
  if (stop.targets.some(isInFlight)) return stop;
  return stop.targets.some((target) => target.state === "revert_failed")
    ? { ...stop, status: "restore_failed" }
    : { ...stop, status: "restored", restoredAt: stopTimestamp(at) };
}

/** Once no target is in flight, the stop is restored, or restore_failed when any revert failed. */
function settleRestore({ stop, at }: { stop: AgentStopRecord; at: number }): AgentStopRecord {
  if (stop.status !== "restoring") return stop;
  if (stop.targets.some(isInFlight)) return stop;
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

/** The dropped target in `state`, none or one; its outcome is its own whatever the round. */
function findDroppedTargets({
  stop,
  targetId,
  state,
}: {
  stop: AgentStopRecord;
  targetId: string;
  state: AgentStopTargetOutcome["state"];
}): AgentStopTargetOutcome[] {
  return stop.targets.filter(
    (target) => target.id === targetId && target.dropped === true && target.state === state,
  );
}

function withoutTarget({
  stop,
  target,
}: {
  stop: AgentStopRecord;
  target: AgentStopTargetOutcome;
}): AgentStopRecord {
  return { ...stop, targets: stop.targets.filter((held) => held !== target) };
}

/** An apply outcome from an earlier run of the stop says nothing about the retry in flight. */
function isStaleRetry({
  stop,
  data,
}: {
  stop: AgentStopRecord;
  data: AgentStopTargetSettledEventData;
}): boolean {
  return (data.retryRound ?? 0) !== stop.retryRound;
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
  const [leaving] = findDroppedTargets({ stop, targetId: data.targetId, state: "pending" });
  if (leaving) {
    if (data.alreadyStopped === true || data.gone === true) {
      return resettle({ stop: withoutTarget({ stop, target: leaving }), at });
    }
    const reverting = withTarget({
      stop,
      targetId: leaving.id,
      from: "pending",
      change: (target) => ({ ...target, state: "reverting", appliedAt: stopTimestamp(at) }),
    });
    return resettle({ stop: reverting, at });
  }
  if (stop.status !== "stopping" || isStaleRetry({ stop, data })) return stop;
  const changed = withTarget({
    stop,
    targetId: data.targetId,
    from: "pending",
    change: (target) => ({
      ...target,
      state: "applied",
      errorCode: null,
      appliedAt: stopTimestamp(at),
      ...(data.alreadyStopped ? { alreadyStopped: true } : {}),
      ...(data.gone ? { gone: true } : {}),
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
  const [leaving] = findDroppedTargets({ stop, targetId: data.targetId, state: "pending" });
  if (leaving) return resettle({ stop: withoutTarget({ stop, target: leaving }), at });
  if (stop.status !== "stopping" || isStaleRetry({ stop, data })) return stop;
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
    restoredByApiKeyId: data.requestedByApiKeyId,
    restoreRequestedAt: stopTimestamp(at),
    restoreRound: stop.restoreRound + 1,
    lastRequestId: data.requestId,
    targets: stop.targets.map((target) => restoringOutcome({ target, at })),
  };
  return settleRestore({ stop: restoring, at });
}

/** A target the stop changed is reverted; one that was already stopped is left as it was. */
function restoringOutcome({
  target,
  at,
}: {
  target: AgentStopTargetOutcome;
  at: number;
}): AgentStopTargetOutcome {
  if (target.state === "applied" && target.alreadyStopped) {
    return { ...target, state: "reverted", errorCode: null, revertedAt: stopTimestamp(at) };
  }
  if (target.state === "applied" || target.state === "revert_failed") {
    // The restore's own round answers this revert, not the plan change that once dropped it.
    const { dropId: _dropId, ...rest } = target;
    return { ...rest, state: "reverting", errorCode: null };
  }
  return target;
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
  if (data.dropId !== undefined) return droppedRevertSettled({ stop, data, at, reverted: true });
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
      ...(data.gone ? { gone: true } : {}),
      ...(data.keptDisabled ? { keptDisabled: true } : {}),
    }),
  });
  const [left] = findDroppedTargets({ stop: changed, targetId: data.targetId, state: "reverted" });
  return settleRestore({
    stop: left ? withoutTarget({ stop: changed, target: left }) : changed,
    at,
  });
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
  if (data.dropId !== undefined) return droppedRevertSettled({ stop, data, at, reverted: false });
  if (stop.status !== "restoring" || isStaleRound({ stop, data })) return stop;
  const changed = withTarget({
    stop,
    targetId: data.targetId,
    from: "reverting",
    change: (target) => ({ ...target, state: "revert_failed", errorCode: data.errorCode }),
  });
  return settleRestore({ stop: changed, at });
}

/**
 * A retry applies again what is not surely stopped: a failed or reverted target, or one whose
 * revert failed after it may have taken effect, goes back to pending; plan targets added since join
 * as pending. A target that is still stopped is left unchanged by its apply.
 */
export function retriedStop({
  stop,
  data,
  at,
}: {
  stop: AgentStopRecord;
  data: AgentStopRetryRequestedEventData;
  at: number;
}): AgentStopRecord {
  if (!isRetryableStatus(stop.status)) return stop;
  const targets = [
    ...stop.targets.map(retriedOutcome),
    ...data.targets
      .filter((target) => !stop.targets.some((held) => held.id === target.id))
      .map(pendingOutcome),
  ];
  const retried: AgentStopRecord = {
    ...stop,
    retryRound: stop.retryRound + 1,
    lastRequestId: data.requestId,
    retriedByUserId: data.requestedByUserId,
    retriedByApiKeyId: data.requestedByApiKeyId,
    targets,
  };
  if (!targets.some((target) => target.state === "pending")) {
    return stop.status === "quarantined"
      ? retried
      : settleStop({ stop: { ...retried, status: "stopping" }, at });
  }
  return { ...retried, status: "stopping" };
}

function retriedOutcome(target: AgentStopTargetOutcome): AgentStopTargetOutcome {
  const retried = ["failed", "reverted", "revert_failed"] as const;
  if (!isLive(target) || !retried.some((state) => state === target.state)) return target;
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

/**
 * Targets removed from the plan leave the open stop, so they no longer decide its status. One the
 * stop changed is reverted first, and so is one whose apply is in flight once that apply lands; a
 * pending, failed, gone or already stopped one leaves at once.
 */
export function targetsDroppedStop({
  stop,
  data,
  at,
}: {
  stop: AgentStopRecord;
  data: AgentStopTargetsDroppedEventData;
  at: number;
}): AgentStopRecord {
  if (!isOpenStatus(stop.status)) return stop;
  const dropped = new Set(data.targetIds);
  let changed = false;
  const targets = stop.targets.flatMap((target) => {
    if (!dropped.has(target.id)) return [target];
    const next = droppedOutcomes({ target, status: stop.status, dropId: data.dropId });
    if (next[0] !== target) changed = true;
    return next;
  });
  return changed ? resettle({ stop: { ...stop, targets }, at }) : stop;
}

/** What a dropped target becomes: itself changed, or nothing when it leaves at once. */
function droppedOutcomes({
  target,
  status,
  dropId,
}: {
  target: AgentStopTargetOutcome;
  status: AgentStopStatus;
  dropId: string;
}): AgentStopTargetOutcome[] {
  // Already leaving; a revert that failed is tried again by the next plan change.
  if (target.dropped && target.state !== "revert_failed") return [target];
  switch (target.state) {
    case "pending":
      return status === "pending_approval" ? [] : [{ ...target, dropped: true, dropId }];
    case "failed":
    case "reverted":
      return [];
    case "applied":
      return target.alreadyStopped || target.gone
        ? []
        : [{ ...target, state: "reverting", errorCode: null, dropped: true, dropId }];
    case "reverting":
      return [{ ...target, dropped: true }];
    case "revert_failed":
      return [{ ...target, state: "reverting", errorCode: null, dropped: true, dropId }];
  }
}

/** A dropped target's own revert outcome: reverted leaves the stop, a failure stays on it. */
function droppedRevertSettled({
  stop,
  data,
  at,
  reverted,
}: {
  stop: AgentStopRecord;
  data: AgentStopTargetSettledEventData;
  at: number;
  reverted: boolean;
}): AgentStopRecord {
  const target = stop.targets.find(
    (held) =>
      held.id === data.targetId && held.dropId === data.dropId && held.state === "reverting",
  );
  if (!target) return stop;
  const settled = reverted
    ? withoutTarget({ stop, target })
    : withTarget({
        stop,
        targetId: target.id,
        from: "reverting",
        change: (held) => ({ ...held, state: "revert_failed", errorCode: data.errorCode }),
      });
  return resettle({ stop: settled, at });
}

/** The status an open stop reaches once its targets changed outside a stop or restore round. */
function resettle({ stop, at }: { stop: AgentStopRecord; at: number }): AgentStopRecord {
  switch (stop.status) {
    case "stopping":
    case "stop_failed":
      return settleStop({ stop: { ...stop, status: "stopping" }, at });
    case "restoring":
    case "restore_failed":
      return settleRestore({ stop: { ...stop, status: "restoring" }, at });
    case "quarantined":
      return stop.targets.some(isLive) ? stop : settleEmpty({ stop, at });
    case "pending_approval":
      // Nothing was applied yet, so a stop left with no target has nothing to wait for.
      return stop.targets.length > 0 ? stop : settleEmpty({ stop, at });
    default:
      return stop;
  }
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

function isInstant(value: string): boolean {
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}

const stopCursorSchema = z.object({
  r: z.string().refine(isInstant, "not a timestamp"),
  i: z.string().min(1),
});

/** The page position after `stop`, as the opaque `next_cursor` the stop listing answers. */
export function encodeStopCursor(stop: StopPosition): string {
  return Buffer.from(JSON.stringify({ r: stop.requestedAt, i: stop.id })).toString("base64url");
}

/** The position a stop listing cursor names; refused as a validation error when it is not one. */
export function decodeStopCursor(cursor: string): StopPosition {
  try {
    const parsed = stopCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return { requestedAt: parsed.r, id: parsed.i };
  } catch {
    throw new GovernanceValidationError("The cursor is not one this listing returned.", {
      formErrors: ["cursor is invalid"],
    });
  }
}

const RESTORE_STATUSES: readonly AgentStopStatus[] = ["restoring", "restore_failed", "restored"];

/**
 * Whether the stop already moved past this apply (a later retry, or a restore of its round), so
 * a retried intent must not touch the platform. A row that lags behind the intent is not past it.
 */
export function isApplySuperseded({
  stop,
  retryRound,
}: {
  stop: AgentStopRecord;
  retryRound: number;
}): boolean {
  if (stop.retryRound !== retryRound) return stop.retryRound > retryRound;
  return RESTORE_STATUSES.includes(stop.status);
}

/**
 * Whether the stop already moved past this revert: a later restore, a retry or close after its
 * round, or, for a plan drop, the target left or no longer carries that drop. A restore does not
 * end a drop's revert, which still settles the target. A lagging row is not past it.
 */
export function isRevertSuperseded({
  stop,
  targetId,
  restoreRound,
  dropId,
}: {
  stop: AgentStopRecord;
  targetId: string;
  restoreRound: number;
  dropId: string | undefined;
}): boolean {
  if (stop.restoreRound < restoreRound) return false;
  if (dropId === undefined) {
    if (stop.restoreRound > restoreRound) return true;
    return stop.status !== "restoring" && stop.status !== "restore_failed";
  }
  if (stop.status === "restored") return true;
  const target = stop.targets.find((held) => held.id === targetId);
  if (!target) return true;
  // A later restore that took the target over strips its drop: then only that round answers it.
  if (stop.restoreRound > restoreRound) return target.dropId !== dropId;
  return target.dropId !== undefined && target.dropId !== dropId;
}
